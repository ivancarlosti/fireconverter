# Architecture

## One process, two worlds

```
┌──────────────────────────── browser ────────────────────────────┐
│ Vue 3 SPA                                                        │
│  ├─ image engine     Canvas (no network)         │
│  ├─ audio engine     @ffmpeg/ffmpeg + @ffmpeg/core (wasm)        │
│  └─ video engine     wasm (local) OR POST /api/jobs (server)     │
└───────────────────────────────┬──────────────────────────────────┘
                                │ same origin
┌───────────────────────────────▼──────────────────────────────────┐
│ Go net/http                                                       │
│  ├─ middleware        CSP, security headers, request id, access log│
│  ├─ handlers          health, formats, jobs, confirm, download    │
│  ├─ jobs.Manager      map + queue + TTL + per-IP cap              │
│  ├─ convert           ffprobe, planner, two-pass ffmpeg runner    │
│  └─ web.Dist()        embedded Vue build (including the wasm core)│
└───────────────────────────────────────────────────────────────────┘
```

The binary is self-contained: the SPA is embedded with `//go:embed`, so a
release image needs no Node and no static file server.

## Why the split?

VERT's key insight is that most files do not need a server. FireConverter keeps
that split and makes it explicit in the UI:

- **images** are decoded and encoded by the browser; there is no upload path;
- **audio** is converted by the bundled single-thread ffmpeg.wasm core;
- **video** is the only category with a server path, because browser video
  encoding is slow and some containers are not decodable by the browser.

The server API still accepts audio (the engine is generic), but the UI does not
offer it. That keeps the privacy promise simple: *images and audio never leave
the device*.

## Browser engines

### Images — `src/engine/image.ts`, `canvas.ts`

1. `createImageBitmap(file, { imageOrientation: 'from-image' })` (fallback to
   `<img>` for SVG).
2. Apply width/height/fit/no-upscale rules.
3. Draw into a canvas; JPEG gets a background fill.
4. Encode with `canvas.toBlob`.
5. Target mode binary-searches quality, then downscales.

No worker is used because Canvas encoding is asynchronous and fast enough; this
also avoids transferring large ImageBitmaps.

### Audio/video — `src/engine/ffmpeg/`

- **core.ts** loads the pinned single-thread core from `/ffmpeg/` (or Blob URLs
  created from a streaming fetch that reports download progress), keeps one
  `FFmpeg` instance, serializes `exec` calls with a promise lock, and terminates
  the worker on cancel.
- **args.ts** builds the same command shape as the server: CRF for quality,
  two-pass ABR for target size, VP9/Opus for WebM, palette filter for GIF.
- **convert.ts** probes the file through ffmpeg's banner (the browser may not
  decode MKV/AVI), rebuilds the plan with the real duration/audio presence,
  runs the pass(es), verifies the byte count, retries once at 85%, and cleans
  the MEMFS files.
- **run.ts** attaches a single `progress` listener and maps `time / duration`
  into the current pass window (0–49, 49–100).

The engine is lazy: nothing is downloaded until the first local audio/video
conversion. The 31 MiB core is cached by the browser and served with an
immutable cache policy under a version query.

## Server

### Job lifecycle

`jobs.Manager` owns a map, a 128-slot queue, `MAX_CONCURRENT_JOBS` workers and a
sweeper. `Submit` streams the upload to `WORK_DIR/<id>/input.<ext>`, probes it,
plans a target (if requested), and either queues it or leaves it at
`awaiting_confirmation`.

A worker sets `running`, executes `convert.Run`, and records `done`/`failed`/
`canceled`. Inputs are deleted immediately; outputs wait for the TTL or an
explicit delete. `Confirm` releases an awaiting job; `Cancel` cancels the
context, which kills the ffmpeg process.

### Planner and runner

`internal/convert/plan.go` is pure arithmetic (see [target-size.md](target-size.md)).
`runner.go` tries the plan, verifies the output size, and retries once with
`bitrate × 0.85`. `execute` reads ffmpeg's `-progress pipe:1` stream and maps
`out_time_us` into a percentage window; stderr is kept in a 16 KiB tail buffer
so an encoder failure can be explained without leaking paths.

### HTTP layer

`handlers.Server.Handler()` is a `http.ServeMux` with method patterns
(`POST /api/jobs/{id}/confirm`). Middleware adds request IDs, panic recovery,
security headers and CSP, structured access logs, and JSON errors with stable
codes.

The SPA is the `/` handler with a history fallback; unknown `/api` paths are
JSON 404s. `web/dist` is embedded, including `/ffmpeg/ffmpeg-core.wasm`.

## Storage and cleanup

- Each job has one directory, addressed only by a 128-bit random ID.
- Inputs are removed as soon as encoding ends.
- The sweeper runs every 2 minutes and removes non-running jobs older than
  `JOB_TTL_MINUTES`.
- Deleting a card calls `DELETE /api/jobs/{id}`; the directory is removed 5
  seconds later to let ffmpeg exit.

## Frontend state

`stores/converter.ts` is the orchestration layer:

- `addFiles` classifies by extension/MIME, creates per-file settings, and probes
  metadata in the background;
- `convertFile` chooses image/local/server;
- target-size jobs call `preparePlan` and push a `PlanEntry` into `planQueue`;
- the review dialog (`TargetPlanDialog`) confirms one or all;
- server jobs are polled with a self-rescheduling timeout;
- results are Blob URLs (local) or `download_url` (server, fetched on demand);
- removing/resetting revokes URLs and deletes server jobs.

Preferences and theme/language live in their own Pinia stores backed by
`localStorage`. There is no global server state to synchronise.

## Security boundaries

- The server only accepts audio/video and never sees image/audio content from
  the UI's local engines.
- ffmpeg runs without a shell and only with server-generated paths.
- The CSP allows `blob:` and `'wasm-unsafe-eval'` for the wasm core; everything
  else is same-origin.
- No authentication is built in; see [security.md](security.md).

## Decisions and trade-offs

| Decision | Why |
| :-- | :-- |
| Go stdlib instead of Gin | No third-party dependencies; smaller supply chain; Go 1.22 routing is sufficient. |
| Single-thread ffmpeg.wasm | Works without COOP/COEP and on plain HTTP LANs; slower than multi-thread. |
| Polling instead of WebSocket | Simpler behind proxies; a 1 s poll is cheap. |
| In-memory jobs | No database; a restart loses jobs, but files are temporary by design. |
| Canvas for images | Instant, no 31 MiB download, and the formats users actually share. |
| Server only for video in the UI | Keeps the privacy promise and the UI honest. |
| Seven full catalogs | The sync project convention; RTL Arabic is a first-class layout. |

## Non-goals

Documents/PDF, accounts, billing, cloud storage, persistent job history, and
codec packs beyond what ffmpeg.wasm and Alpine ffmpeg provide.
