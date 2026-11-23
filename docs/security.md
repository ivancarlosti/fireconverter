# Security

## Threat model

FireConverter is a single-tenant, no-account converter. The assets are:

- the host running ffmpeg;
- the temporary uploads in `WORK_DIR`;
- the server's CPU and disk;
- the user's browser content (images/audio must not be exfiltrated).

Out of scope: multi-tenant isolation, per-user quotas, billing abuse and
long-term storage. The intended deployment is a trusted LAN or an instance
behind an authenticating reverse proxy.

## No built-in authentication

There is deliberately no login. Anyone who can reach the port can submit a
video and consume CPU. Before exposing the instance:

1. put it behind a reverse proxy with authentication (basic auth, OIDC, VPN);
2. keep `MAX_CONCURRENT_JOBS` and `MAX_JOBS_PER_IP` low;
3. set `APP_TRUST_PROXY=true` only when the proxy overwrites
   `X-Forwarded-For`.

The UI never calls the server for images or audio, so their content never
leaves the browser even on a shared instance.

## Browser controls

- **CSP**: `default-src 'self'`; scripts allow `'self' blob:
  'wasm-unsafe-eval'` (ffmpeg core); workers allow `blob:`; media/image allow
  `blob:`; connections allow `'self' blob:`; frames are denied
  (`frame-ancestors 'none'`); objects are denied.
- **Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`, restrictive
  `Permissions-Policy`.
- **No third-party resources**: no fonts, analytics, CDNs or donation widgets.
  The app works offline after the first load.
- **Object URLs**: revoked when a card is removed/reset.
- **No token in JavaScript**: the app uses same-origin requests only.

## Upload handling

- `http.MaxBytesReader` enforces `MAX_UPLOAD_MB` before multipart parsing.
- The filename is reduced to its base name and sanitised (control characters,
  `/\:*?"<>|`, 160 runes). It is used only for display and
  `Content-Disposition`.
- The input path is generated (`WORK_DIR/<random>/input.<ext>`), never derived
  from the filename.
- The extension must be in the allow-list (`internal/convert/formats.go`).
- ffprobe must parse the file and the duration/stream checks must pass before a
  job is created.
- Images are rejected with `image_local`; the server never stores them.

## ffmpeg execution

- `exec.CommandContext` with an argument slice; **no shell**.
- Temporary paths come from the server, not the request.
- `-hide_banner -loglevel error`; output is parsed, not interpolated into a
  shell.
- A context cancellation kills the process.
- On Linux the container's `init: true` reaps orphaned children.
- Encoder stderr is truncated to 600 characters and the job/output paths are
  replaced with `input`/`output` before it reaches the client.

## Storage and TTL

- One directory per job, mode `0750`, created by the runtime user.
- Inputs are removed immediately after encoding.
- Outputs are removed by the TTL sweeper (every 2 minutes) and on `DELETE`.
- A restart loses the in-memory map; orphan directories are removed on the next
  sweep after the TTL.
- Downloads are served only for `done` jobs and only through the random ID.

## Resource limits

| Control | Default |
| :-- | :-- |
| Upload | 2 GiB |
| Duration | 6 h |
| Concurrent encodes | 2 |
| Active jobs per IP | 4 |
| Queue | 128 |
| Target | 4 GiB |
| Job TTL | 60 min |

`MAX_JOBS_PER_IP` counts non-finished jobs, including ones awaiting review.
`APP_TRUST_PROXY` must stay false unless a trusted proxy writes the header.

## Container

- Alpine runtime, unprivileged `app` user.
- `no-new-privileges` in compose; `init: true`.
- Read-only application files; only `WORK_DIR` is writable.
- `HEALTHCHECK` hits `/api/health`.
- No secrets are required. Do not bake `.env` files into images.

## Supply chain

- The Go binary uses the standard library only.
- npm dependencies are pinned and locked (`package-lock.json`); the final image
  contains no Node.
- The ffmpeg.wasm core is pinned to `@ffmpeg/core@0.12.10` and copied from the
  lockfile install.
- The Docker image installs Alpine's ffmpeg package; rebuild regularly to pick
  up CVEs. `.github/workflows/build.yml` already rebuilds the newest release
  weekly.
- CodeQL/dependency alerts are checked before and after changes in this
  repository's automation.

## Privacy

- Images/audio: no network request containing the file.
- Video: uploaded only when the user selects *This server*.
- Logs contain paths, sizes, status and timing, never file content.
- No cookies, accounts or analytics.

## Reporting

Open a private security advisory on GitHub
(<https://github.com/ivancarlosti/fireconverter/security/advisories/new>) rather
than a public issue. Include the version, deployment (Docker/source), the
request and the impact. Do not include real user media.
