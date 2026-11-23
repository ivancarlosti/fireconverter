# Fix stale service worker blocking local video

## Context

`https://conversor.icc.gg/sw.js` and `/service-worker.js` return the SPA
`index.html` instead of JavaScript. The current repository has no service-worker
registration, so the `[SW] serving from cache: .../worker-BOtfBjWk.js` log comes
from a worker installed by an older deployment. Because the browser's update
check receives HTML, it cannot parse a replacement script and the old worker
stays active indefinitely, serving cached assets (and potentially a stale
ffmpeg core) to local conversions.

The deployed ffmpeg worker matches the local build (`sha256` identical) and the
wasm core is served as `application/wasm`, so the server assets themselves are
not the problem. The `A listener indicated an asynchronous response...` console
errors come from browser extension messaging, not from FireConverter or
ffmpeg.wasm.

## Goal

Make it possible for affected browsers to evict the old worker automatically,
prevent the SPA fallback from ever answering a missing script with HTML again,
and verify local video/audio conversion in a clean browser.

## Steps

1. Add `web/public/sw.js` as a one-time legacy cleanup worker:
   - `install`: `skipWaiting`.
   - `activate`: claim clients, delete every CacheStorage entry, unregister.
   - Do not force a tab reload, so an in-progress conversion is not aborted.
2. Harden `internal/handlers/spa.go`:
   - serve `/sw.js` with `Cache-Control: no-cache`;
   - return a JSON 404 for missing `.js`, `.mjs`, `.css` and `.wasm` paths
     instead of falling back to `index.html`.
3. Add `internal/handlers/spa_test.go` covering the service-worker response,
   immutable hashed assets, the missing-script 404 and the SPA fallback.
4. Add `web/scripts/e2e-service-worker.mjs` to register the cleanup worker,
   assert that it removes a test cache and unregisters itself, and fail on
   browser console errors.
5. Document the manual recovery steps in `docs/usage.md`, the cleanup worker in
   `docs/development.md`, and the `/sw.js` caching requirement for reverse
   proxies in `docs/configuration.md`.
6. Build and validate:
   - `cd web && npm run build`;
   - `go test ./...`;
   - run a local binary and check `/sw.js` headers/body;
   - run the service-worker, video and audio browser smoke tests.
7. Deploy, then verify production `/sw.js` is JavaScript with `no-cache`, purge
   any proxy cache, unregister manually in the affected browser if the update
   check is delayed, and rerun the video smoke test against production.
8. After any push, wait 3-5 minutes and rerun the GitHub Dependabot/code-scanning
   checks plus the workflow list. Fix new alerts before finishing.

## Risks

- Clearing all CacheStorage for the origin also removes unrelated caches. The
  app does not use CacheStorage, and `localStorage` preferences are untouched.
- The kill switch does not reload open tabs; users may need one manual reload to
  load the fresh bundle.
- Browsers can throttle service-worker update checks. Manual unregister remains
  the immediate recovery path.
- The fix targets the `/sw.js` script URL. A registration at another path (for
  example `/assets/sw.js`) needs the same cleanup file at that exact path.
- The SPA 404 hardening is limited to script/style/wasm extensions so routes
  containing dots are unaffected.
- If conversion still fails in a clean browser after the cleanup, that is a
  second issue; capture the worker error and the ffmpeg core network response.
