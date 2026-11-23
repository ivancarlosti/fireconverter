# syntax=docker/dockerfile:1
# =============================================================================
#  FireConverter — one image (frontend + backend + ffmpeg)
#  Stage 1: build the Vue SPA into web/dist
#  Stage 2: build the Go binary with the SPA embedded
#  Stage 3: Alpine runtime with ffmpeg, non-root, healthcheck
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — frontend (Vue 3 + Vite + TailwindCSS)
# -----------------------------------------------------------------------------
FROM node:24-alpine AS frontend

WORKDIR /app/web

# Dependency layer: only manifests, so npm ci is cached between source edits.
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Sources (web/dist, node_modules and the huge wasm core are excluded).
COPY web/ ./

# prebuild copies @ffmpeg/core into public/ffmpeg, then Vite builds dist.
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2 — backend (Go standard library only)
# -----------------------------------------------------------------------------
FROM golang:1.27.3-alpine AS builder

ARG VERSION=dev
ARG COMMIT=unknown

WORKDIR /src

RUN apk add --no-cache ca-certificates tzdata

COPY go.mod ./
COPY . ./

# The compiled SPA replaces the placeholder committed in web/dist (.gitkeep).
COPY --from=frontend /app/web/dist ./web/dist

ENV CGO_ENABLED=0 \
    GOOS=linux
RUN go build -trimpath \
      -ldflags "-s -w \
        -X github.com/ivancarlosti/fireconverter/internal/version.Version=${VERSION} \
        -X github.com/ivancarlosti/fireconverter/internal/version.Commit=${COMMIT}" \
      -o /out/fireconverter ./cmd/server

# -----------------------------------------------------------------------------
# Stage 3 — runtime
# -----------------------------------------------------------------------------
FROM alpine:3.22

# ffmpeg: the server video engine.
# ca-certificates/tzdata: TLS and correct timestamps in logs.
RUN apk add --no-cache ffmpeg ca-certificates tzdata \
 && addgroup -S app \
 && adduser -S -G app -h /app app \
 && mkdir -p /tmp/fireconverter \
 && chown app:app /tmp/fireconverter

COPY --from=builder /out/fireconverter /usr/local/bin/fireconverter

WORKDIR /app
USER app

ENV APP_PORT=3000 \
    WORK_DIR=/tmp/fireconverter

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O- "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/usr/local/bin/fireconverter"]
