# API

The API is same-origin JSON over HTTP. There is no authentication in the app
itself; deploy behind an authenticating reverse proxy if the instance is public.
Images are never accepted: the server only converts audio and video.

Base path: `/api`.

## Error envelope

Every failure returns:

```json
{ "code": "target_too_small", "error": "the target size is too small for this file (minimum 0.1 MB)" }
```

The SPA translates `code`; `error` is technical detail and may change.

| HTTP | Code | Meaning |
| :-- | :-- | :-- |
| 400 | `validation` | Malformed settings/body |
| 400 | `image_local` | Images must be converted in the browser |
| 400 | `empty_file` | Upload is empty |
| 404 | `not_found` | Unknown/expired job |
| 409 | `invalid_state` | Confirm/download before the job is ready |
| 413 | `too_large` | Upload exceeds `MAX_UPLOAD_MB` |
| 415 | `unsupported` | Unknown input/output |
| 422 | `too_long` | Duration exceeds `MAX_DURATION_SECONDS` |
| 422 | `target_too_small` | Target below the reachable minimum |
| 422 | `target_unsupported` | Lossless/GIF target |
| 422 | `target_missed` | Encoder could not fit after retry |
| 422 | `no_video` / `no_audio` | Required stream missing |
| 422 | `probe_failed` | ffprobe could not read the file |
| 429 | `busy` | Queue or per-IP cap reached |
| 503 | `ffmpeg_missing` | Server engine unavailable |
| 500 | `encode_failed` / `internal` | Encoder/internal failure |

## System

### `GET /api/health`

```json
{
  "status": "ok",
  "version": { "name": "FireConverter", "version": "1.2.3", "commit": "…", "go_version": "go1.27.3" },
  "server_conversion": true,
  "ffmpeg_version": "ffmpeg version 6.1.2",
  "max_upload_bytes": 2147483648,
  "max_duration_seconds": 21600,
  "target_size_max_bytes": 4294967296,
  "job_ttl_seconds": 3600,
  "max_concurrent_jobs": 2,
  "max_jobs_per_ip": 4,
  "uptime_seconds": 42,
  "locales": ["en-US", "pt-BR", "es-MX", "fr-FR", "h-CN", "hi-IN", "ar-SA"],
  "themes": ["light", "dark", "system"]
}
```

`server_conversion=false` means ffmpeg/ffprobe are missing; local conversion
still works.

### `GET /api/version`

Build metadata plus the same capabilities.

### `GET /api/formats`

The server output catalogue, accepted input extensions and limits. Each output
has `target_size: true|false`.

## Jobs

A job moves through:

```
awaiting_confirmation ──confirm──> queued ──> running ──> done
        │                            │           │
        └──────── cancel ────────────┴───────────┴──> canceled
                                                  └──> failed
```

A non-target job skips `awaiting_confirmation`.

### `POST /api/jobs`

`multipart/form-data`:

| Field | Type | Notes |
| :-- | :-- | :-- |
| `file` | file | Audio or video |
| `settings` | JSON string | See below |

```json
{
  "output": "mp4",
  "target_mb": 8,
  "audio_kbps": 128,
  "quality": "balanced",
  "scale": "1280x720",
  "fps": 30
}
```

- `target_mb: 0` disables target mode.
- `quality` is `high`, `balanced` or `small` (ignored in target mode).
- `scale` and `fps` are optional.
- `audio_kbps` 0 lets the server choose.

Response `202` with a job view. A target-size job is
`status: "awaiting_confirmation"` and includes `plan`:

```json
{
  "id": "9f0c…",
  "status": "awaiting_confirmation",
  "file_name": "clip.mp4",
  "kind": "video",
  "output": "mp4",
  "output_name": "clip-converted.mp4",
  "input_size": 3802425,
  "output_size": 0,
  "plan": {
    "target_bytes": 500000,
    "target_mb": 0.5,
    "duration_seconds": 4,
    "video_bitrate_kbps": 874,
    "audio_bitrate_kbps": 96,
    "passes": 2,
    "estimated_bytes": 500000,
    "width": 1280,
    "height": 720,
    "fps": 30
  },
  "probe": { "duration_seconds": 4, "width": 1280, "height": 720, "fps": 30, "has_audio": true },
  "created_at": "…",
  "updated_at": "…"
}
```

### `POST /api/jobs/{id}/confirm`

Releases an `awaiting_confirmation` job. Returns the updated view. Confirming a
job in another state is `409 invalid_state`.

### `GET /api/jobs/{id}`

Poll every ~1 s. `progress` is 0–100; `stage` is `starting`, `pass1`, `pass2`,
`encode` or `done`. A finished job includes `download_url`.

### `POST /api/jobs/{id}/cancel`

Cancels a waiting or running job. Idempotent while the job exists; a finished
job returns `409`.

### `GET /api/jobs/{id}/download`

Returns the file with `Content-Disposition: attachment` and
`Content-Type` for the output. Only `status=done` is downloadable.

### `DELETE /api/jobs/{id}`

Erases the job and its directory. `204` on success.

## Limits

| Limit | Default |
| :-- | :-- |
| Upload | 2048 MB |
| Duration | 21600 s |
| Target | 4096 MB |
| Concurrent encodes | 2 |
| Active jobs per IP | 4 |
| Queue | 128 |
| Job TTL | 60 min |

Per-IP counting uses `RemoteAddr` unless `APP_TRUST_PROXY=true`; then the first
`X-Forwarded-For` address is used.

## cURL example

```bash
# 1. create (target size)
curl -s http://localhost:3069/api/jobs \
  -F file=@clip.mp4 \
  -F 'settings={"output":"mp4","target_mb":0.5,"audio_kbps":96,"quality":"balanced"}'

# 2. confirm
curl -s -X POST http://localhost:3069/api/jobs/<id>/confirm

# 3. poll
curl -s http://localhost:3069/api/jobs/<id>

# 4. download
curl -OJ http://localhost:3069/api/jobs/<id>/download
```

## Notes

- There is no WebSocket: polling keeps the deployment simple and survives a
  proxy restart.
- Job IDs are 128-bit random hex values. A job directory is never addressed by
  a user-supplied path.
- The server writes one directory per job under `WORK_DIR`; inputs are removed
  immediately after encoding and outputs at the TTL.
