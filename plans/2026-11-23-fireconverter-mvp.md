# FireConverter MVP

## Context

`fireconverter` currently contains only the GitHub automation workflows and a
one-line README. The product is a VERT-like, privacy-first media converter with
one deliberate improvement: every converter can hit a **target file size** the
user chooses, instead of only offering a quality slider.

VERT's model is the reference:

- images are converted on the device;
- audio is converted on the device;
- video can be converted on the device or by a server.

FireConverter keeps that split, adds target-size mode to all three, and ships as
one Go binary with an embedded Vue SPA. The server never receives images or
audio unless the operator calls the API directly; video is the only category
with a server path in the UI.

## Goal

A single-page application that:

1. accepts images, audio and video by drag and drop or file picker;
2. converts images locally (Canvas/OffscreenCanvas);
3. converts audio locally (bundled ffmpeg.wasm);
4. converts video locally (ffmpeg.wasm) or on the server (ffmpeg);
5. supports **target size** for images, audio and video, shows a review dialog
   before a target-size job starts, and never exceeds the requested cap;
6. exposes resize for images and optional scale/FPS for video;
7. persists user preferences (formats, quality, engine, auto-download);
8. works in seven languages including RTL Arabic and light/dark/system themes;
9. ships with docs, screenshots, Docker image and compose file.

Non-goals: documents/PDF, accounts, billing, donations, cloud storage, format
conversion for categories other than image/audio/video.

## Architecture

```
browser
  ├─ image engine   Canvas / OffscreenCanvas (no upload)
  ├─ audio engine   @ffmpeg/ffmpeg + @ffmpeg/core (wasm, no upload)
  └─ video engine   wasm (local) or POST /api/jobs (server)
                         │
Go server (net/http, no third-party deps)
  ├─ API: health, version, formats, jobs, confirm, cancel, download
  ├─ job manager: in-memory, TTL, concurrency + per-IP caps
  └─ convert: ffprobe + ffmpeg (two-pass target size, progress)
```

The SPA is compiled by Vite into `web/dist`, embedded with `//go:embed`, and
served by the same binary. `web/dist/.gitkeep` keeps `go build` working before
the first frontend build. `npm run build` restores it afterwards.

## Target-size algorithm

Constants: 3% container overhead reserve, minimum video bitrate 50 kbps,
minimum audio bitrate 8 kbps, maximum audio 320 kbps.

For a duration `d` seconds and target `T` bytes:

```
total_kbps = T * 8 / d / 1000 * 0.97
```

- Audio: `bitrate = total_kbps`, clamped to [8, 320]. Lossless outputs (WAV,
  FLAC) reject target mode.
- Video: reserve audio first (`min(requested, 25% of total)`, at least 64 kbps
  when possible), the rest is the video bitrate. If video < 50 kbps, reject with
  the minimum target size the file can reach.
- Server video: two-pass encode (H.264/AAC for MP4/MOV/MKV, VP9/Opus for WebM).
  After encoding, if the result is more than 2% over target, retry once with a
  reduced bitrate.
- Local video: same plan; two-pass encode in wasm (H.264 or VP9), with the
  same post-encode verification and one retry.
- Images: binary search quality (JPEG/WebP/AVIF); if the minimum quality is
  still too large, downscale iteratively. PNG has no quality knob, so only the
  dimensions are reduced. The result is verified against the cap.

## Steps

1. Scaffold Go module, config, version, format registry, probe/planner/runner,
   in-memory job manager and HTTP handlers.
2. Scaffold Vue 3 + Vite + Tailwind 4 + shadcn-style primitives; port theme,
   i18n and feedback conventions.
3. Implement local image, audio and video engines plus the server video client.
4. Build the single-page converter UI: dropzone, file cards, per-file settings,
   target review dialog, progress, results, preferences dialog.
5. Add seven locale catalogs and the i18n parity checker.
6. Add Dockerfile, docker compose, docs and screenshot capture.
7. Validate: `go test`, `npm run build`, Docker build, API E2E (target-size
   video), screenshot capture, security checks.

## Risks

- **ffmpeg.wasm size and speed**: the core is ~31 MiB and video encoding is
  slow. Mitigation: lazy load with progress, local video labelled "slower",
  server video recommended by default, single-thread core for compatibility.
- **Browser codec coverage**: Canvas cannot encode AVIF everywhere and cannot
  decode TIFF. Mitigation: feature-detect AVIF and hide it; document supported
  formats; use ffmpeg.wasm for audio/video containers.
- **Target-size overshoot**: muxing overhead and VBR variance. Mitigation: 3%
  reserve, maxrate/bufsize, post-encode verification and one retry.
- **Abuse of the server path**: large uploads and CPU time. Mitigation: 2 GiB
  upload cap, 6 h duration cap, 2 concurrent jobs, 4 jobs per IP, TTL cleanup,
  optional reverse-proxy auth documented.
- **Supply chain**: npm dependencies and ffmpeg package. Mitigation: pinned
  versions, npm lockfile, Alpine ffmpeg, no runtime npm in the final image.
- **Licensing**: VERT is AGPL-3.0. FireConverter is an independent
  implementation; no VERT source is copied.
