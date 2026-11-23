package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"
)

// middleware applies the cross-cutting concerns of every request:
// identification, panic recovery, security headers and access logging.
func (s *Server) middleware(next http.Handler) http.Handler {
	return s.recoverer(s.requestID(s.securityHeaders(s.accessLog(next))))
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// `wasm-unsafe-eval` is required to compile the bundled ffmpeg core;
		// `blob:` lets the SPA load that core from a Blob URL (the fallback is
		// the same file served from /ffmpeg/). Styles allow inline because
		// reka-ui positions its popovers inline and Vite injects style elements.
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; "+
				"script-src 'self' blob: 'wasm-unsafe-eval'; "+
				"style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data: blob:; "+
				"media-src 'self' blob:; "+
				"font-src 'self' data:; "+
				"connect-src 'self' blob:; "+
				"worker-src 'self' blob:; "+
				"manifest-src 'self'; "+
				"object-src 'none'; "+
				"base-uri 'self'; "+
				"form-action 'self'; "+
				"frame-ancestors 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-Id")
		if requestID == "" {
			buffer := make([]byte, 8)
			if _, err := rand.Read(buffer); err == nil {
				requestID = hex.EncodeToString(buffer)
			} else {
				requestID = fmt.Sprintf("%d", time.Now().UnixNano())
			}
		}
		w.Header().Set("X-Request-Id", requestID)
		next.ServeHTTP(w, r)
	})
}

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.Error("panic while serving a request",
					"panic", recovered,
					"path", r.URL.Path,
					"stack", string(debug.Stack()))
				writeError(w, http.StatusInternalServerError, "internal", "unexpected error, check the server logs")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// statusRecorder captures the status and size for the access log.
type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(p []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	written, err := r.ResponseWriter.Write(p)
	r.bytes += written
	return written, err
}

func (s *Server) accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(recorder, r)
		status := recorder.status
		if status == 0 {
			status = http.StatusOK
		}
		slog.Info("http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", status,
			"bytes", recorder.bytes,
			"duration_ms", time.Since(started).Milliseconds(),
			"remote", clientIP(r, s.cfg.TrustProxy),
			"request_id", w.Header().Get("X-Request-Id"))
	})
}
