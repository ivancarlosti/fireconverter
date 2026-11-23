# Configuration

FireConverter reads `.env` and `docker/.env` (best effort) and then the real
environment. Existing environment variables always win. Nothing else reads
`os.Getenv`; every value is validated at boot and the process exits with all
problems listed.

## Variables

| Variable | Default | Description |
| :-- | :-- | :-- |
| `APP_PORT` | `3000` | HTTP listen port. |
| `WORK_DIR` | `/tmp/fireconverter` | Root for per-job directories. Must be writable by the runtime user. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |
| `APP_TRUST_PROXY` | `false` | Read the first `X-Forwarded-For` address for the per-IP cap. Only enable behind a proxy that overwrites the header. |
| `MAX_UPLOAD_MB` | `2048` | Largest server upload (MiB). |
| `MAX_DURATION_SECONDS` | `21600` | Longest server media (6 h). |
| `JOB_TTL_MINUTES` | `60` | Age after which a finished job and its files are swept. |
| `MAX_CONCURRENT_JOBS` | `2` | ffmpeg processes in parallel. |
| `MAX_JOBS_PER_IP` | `4` | Non-finished jobs per client. |
| `TARGET_SIZE_MAX_MB` | `4096` | Largest target the API accepts. |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg binary. |
| `FFPROBE_PATH` | `ffprobe` | ffprobe binary. |

`MAX_UPLOAD_MB` and `TARGET_SIZE_MAX_MB` use MiB for uploads and decimal MB for
targets — the target math is decimal (`0.5 MB = 500,000 bytes`).

With Docker Compose, the `APP_PORT` in `docker/.env` is the **host** port only.
The container is fixed at `3000`, the healthcheck targets `3000`, and the compose
port mapping publishes `${APP_PORT:-3069}:3000`. For a source run, set the port
explicitly (`APP_PORT=3000 go run ./cmd/server`) so a compose `.env` does not move
the dev server away from Vite's proxy target.

## Disabling server conversion

Point `FFMPEG_PATH` at a missing binary (for example
`FFMPEG_PATH=/nonexistent`) or run the binary without ffmpeg installed. The
health endpoint reports `server_conversion: false`; the UI disables the server
engine and keeps local conversion. The Docker image always includes ffmpeg.

## Docker Compose

```bash
cd docker
cp .env.example .env
docker compose up --build -d
docker compose logs -f
```

The compose file:

- publishes `${APP_PORT:-3069}` on the host, forwarding to container port `3000`;
- keeps `WORK_DIR` on the `fireconverter-work` named volume;
- runs with `init: true`, `no-new-privileges`, and a 30-second stop grace period;
- passes every limit through environment variables.

The compose file also has a `build` section pointing at the repository root, so
`docker compose up --build` works on a fresh checkout. To use a different host
port, change `APP_PORT` in `docker/.env`; do not change the container port or
the healthcheck.

The image creates `/tmp/fireconverter` owned by the unprivileged `app` user, so
the named volume inherits the right owner on first use.

If a rootless builder rejects `docker compose up --build` with a Bake sandbox
error, build the image first and start the stack without `--build`:

```bash
docker build -t ghcr.io/ivancarlosti/fireconverter:local .
cd docker && docker compose up -d
```

## Reverse proxy

The SPA and API share one origin, so a proxy only needs to forward everything
to the published host port (`3069` with the default compose file). Requirements:

1. **Do not buffer or cap the wasm core** below ~32 MB. `/ffmpeg/ffmpeg-core.wasm`
   must be served as `application/wasm`.
2. **Allow long uploads and downloads** (large videos, progress polling).
3. **Set `APP_TRUST_PROXY=true`** only if the proxy overwrites
   `X-Forwarded-For`.
4. **Add authentication** before exposing the instance: FireConverter has no
   login of its own.

### Caddy

```caddy
convert.example.com {
    reverse_proxy 127.0.0.1:3069 {
        flush_interval -1
    }
    request_body {
        max_size 2GB
    }
}
```

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name convert.example.com;
    client_max_body_size 2g;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    location / {
        proxy_pass http://127.0.0.1:3069;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
    }
}
```

If you use Nginx basic auth:

```nginx
auth_basic "FireConverter";
auth_basic_user_file /etc/nginx/.htpasswd;
```

## Work directory

Each job gets `WORK_DIR/<32 hex>/` with `input.<ext>` and `output.<ext>`.
Inputs are removed after encoding; outputs are removed by the TTL sweeper (every
2 minutes) or by `DELETE /api/jobs/{id}`. A restart loses in-memory jobs but the
next sweep removes orphaned directories after the TTL.

## Logging

Logs are structured text on stderr:

```
time=… level=INFO msg="http request" method=POST path=/api/jobs status=202 duration_ms=12 remote=…
```

Uploads are counted in bytes but never logged as content. Filenames are logged
only as part of errors that the user already sees.

## Localisation and theme

The server advertises the seven locale codes and three theme preferences; the
SPA owns the catalogs and the persisted choice. There is no server-side locale
configuration because the app has no accounts or email.
