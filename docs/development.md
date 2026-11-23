# Development

## Requirements

| Tool | Version | Why |
| :-- | :-- | :-- |
| Go | 1.24+ | Server (standard library only) |
| Node.js | 22+ (24 recommended) | Vite, TypeScript, screenshot tooling |
| ffmpeg / ffprobe | 6+ | Server video (optional for local-only work) |
| Chrome/Chromium | current | Screenshots and browser smoke tests |
| Python 3 + Pillow | optional | Screenshot compression and fixtures |

## Layout

```
cmd/server/              main: config, manager, HTTP server
internal/config/         env loading and validation
internal/convert/        formats, ffprobe, planner, ffmpeg runner
internal/jobs/           in-memory jobs, queue, TTL, downloads
internal/handlers/       routes, middleware, API, embedded SPA
internal/version/        build metadata
web/                     Vue 3 + Vite SPA
  src/engine/image.ts    Canvas image engine
  src/engine/ffmpeg/     ffmpeg.wasm lifecycle, args, conversion
  src/stores/converter.ts  queue, plans, polling, downloads
  scripts/                i18n checker, ffmpeg-core copier, screenshots
  public/ffmpeg/         generated core (not committed)
  public/sw.js           one-time cleanup for stale service workers (not a PWA)
  dist/                  build output, embedded by Go
docs/                    user, API and operations documentation
plans/                   implementation plans
docker/                  compose file and env template
```

## Fast loop

```bash
# terminal 1
APP_PORT=3000 go run ./cmd/server

# terminal 2
cd web
npm ci
npm run dev
```

Vite serves on 5173 and proxies `/api` to 3000. The production SPA is embedded,
so `go run` serves whatever is in `web/dist` (the `.gitkeep` placeholder before
the first build). Set `APP_PORT=3000` explicitly if `docker/.env` exists; its
`APP_PORT` is the compose host port (3069), not the source/dev port.

## Build

```bash
cd web
npm run build        # prebuild copies the ffmpeg core, typecheck + Vite, postbuild restores .gitkeep
cd ..
go build ./...
```

`npm run build` runs:

1. `scripts/sync-ffmpeg-core.mjs` — copies
   `node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.{js,wasm}` into
   `public/ffmpeg/` (30.7 MiB wasm; not committed);
2. `scripts/check-i18n.mjs` — catalog parity and placeholder check;
3. `vue-tsc --noEmit` twice (app and Vite config);
4. `vite build` into `dist/`;
5. `scripts/restore-dist-placeholder.mjs` — recreates `dist/.gitkeep` so
   `//go:embed` keeps compiling.

## Tests

```bash
go test ./...        # planner, formats, progress parser
cd web
npm run typecheck    # i18n + TypeScript
```

### Browser smoke tests

They need a running instance and Chrome:

```bash
# local image target-size search
cd web
SMOKE_BASE_URL=http://localhost:3069 node scripts/e2e-image.mjs

# legacy service-worker cleanup
SMOKE_BASE_URL=http://localhost:3069 node scripts/e2e-service-worker.mjs

# local audio (quality and target)
SMOKE_BASE_URL=http://localhost:3069 node scripts/e2e-local.mjs

# local video (quality and target); needs fixtures/demo-video-small.mp4
SMOKE_BASE_URL=http://localhost:3069 node scripts/e2e-video.mjs

# RTL and mobile layout
SMOKE_BASE_URL=http://localhost:3069 node scripts/e2e-ui.mjs

# API server target-size test (Docker image with ffmpeg)
docker run -d --name fc-api -p 3001:3000 fireconverter:test
# then use the multipart example in docs/api.md
```

The image/audio/video smoke scripts default to `http://localhost:3000`; `e2e-ui`
defaults to `3003`. Set `SMOKE_BASE_URL` when testing the compose stack on 3069.

The scripts fail on browser console errors, so a CSP regression is caught.
`e2e-service-worker.mjs` registers the cleanup worker and verifies that it
deletes CacheStorage and unregisters itself.

`web/public/sw.js` is not a PWA service worker and the app never registers it.
It exists only so browsers that still have a worker from an older deployment can
replace it and drop the stale caches; do not add a registration for it.

## Screenshots

```bash
cd web
SCREENSHOT_BASE_URL=http://localhost:3069 npm run screenshots
```

The script:

- launches the installed Chrome over the DevTools Protocol (no dependency);
- injects `scripts/fixtures/demo-photo.png`, `demo-audio.wav` and
  `demo-video.mp4`;
- captures the empty queue, a populated queue, the target review, preferences
  and a real finished image conversion;
- quantizes the PNGs with Pillow and writes `docs/screenshots/`.

Set `SCREENSHOT_BASE_URL`, `SCREENSHOT_DIR`, `SCREENSHOT_DPR` or
`SCREENSHOT_MAX_HEIGHT` to override the defaults.

### Fixtures

| File | Origin |
| :-- | :-- |
| `demo-photo.png` | Pillow gradient/shapes, 1600×1000 |
| `demo-audio.wav` | 4 s sine sweep, 44.1 kHz mono |
| `demo-video.mp4` | 4 s `testsrc2` + sine, H.264/AAC |
| `demo-video-small.mp4` | 1 s 320×180, for the local video smoke test |

Regenerate the video with the command in the README.

## Docker

```bash
docker build -t fireconverter:test .
docker run --rm -p 3069:3000 fireconverter:test
```

Open <http://localhost:3069>. The runtime image is Alpine + ffmpeg (~250 MB) and
runs as `app`. The frontend stage installs with `npm ci`; the Go stage needs no
module downloads (stdlib only).

## Adding a format

1. Add the extension to `web/src/lib/formats.ts` and the output entry with its
   MIME type.
2. Add it to `internal/convert/formats.go` (`inputKinds` and/or `Outputs`) and a
   codec pair in `codecsFor`.
3. Add a target-size decision in `TargetSizeSupported`.
4. Extend the planner test if the new format affects bitrate math.
5. Update `docs/formats.md`.

## Adding a locale

1. Copy `web/src/i18n/locales/en-US.json` to `<code>.json`.
2. Translate every value; keep `{placeholders}` unchanged.
3. Add the catalog and descriptor in `web/src/i18n/index.ts`.
4. Add the code to `SupportedLocales` in `internal/handlers/system.go`.
5. `node scripts/check-i18n.mjs` must print `ok`.

## Gotchas

- `//go:embed all:dist` requires `web/dist` to exist; the committed
  `dist/.gitkeep` is intentional.
- The ffmpeg core is intentionally gitignored; `npm ci && npm run build` is the
  supported way to produce it.
- `npm run build` empties `dist`; `postbuild` restores the placeholder.
- The server's CSP allows `blob:` for scripts and connections because the wasm
  core is loaded from Blob URLs; keep that in mind before tightening it.
- `MAX_CONCURRENT_JOBS` controls worker goroutines; each runs at most one ffmpeg
  process.
