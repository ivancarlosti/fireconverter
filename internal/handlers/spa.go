package handlers

import (
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

const (
	immutableCache = "public, max-age=31536000, immutable"
	revalidate     = "no-cache"
)

// spa serves the embedded SPA with a history fallback. An unknown /api path is
// a JSON 404 instead of index.html, which is what an API client expects.
func (s *Server) spa() http.Handler {
	assets := s.assets
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
			writeError(w, http.StatusNotFound, "not_found", "unknown endpoint "+r.URL.Path)
			return
		}
		requested := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if requested != "" && requested != "." {
			if info, err := fs.Stat(assets, requested); err == nil && !info.IsDir() {
				serveAsset(w, assets, requested)
				return
			}
			// A missing script must not fall through to index.html. The browser
			// parses the HTML as JavaScript, and a service-worker update silently
			// keeps the previous worker. This is what made /sw.js impossible to
			// replace after the old deployment stopped shipping it.
			if looksLikeAsset(requested) {
				writeError(w, http.StatusNotFound, "not_found", "asset not found: "+requested)
				return
			}
		}
		index, err := fs.ReadFile(assets, "index.html")
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "not_configured", "the web interface is not part of this build")
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", revalidate)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(index)
	})
}

func serveAsset(w http.ResponseWriter, assets fs.FS, name string) {
	data, err := fs.ReadFile(assets, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "asset not found: "+name)
		return
	}
	contentType := mime.TypeByExtension(path.Ext(name))
	switch path.Ext(name) {
	case ".wasm":
		contentType = "application/wasm"
	case ".js", ".mjs":
		contentType = "text/javascript; charset=utf-8"
	case ".json":
		contentType = "application/json; charset=utf-8"
	case ".svg":
		contentType = "image/svg+xml"
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	switch {
	case name == "sw.js":
		// The legacy cleanup worker must be revalidated on every visit so an
		// old registration can always be replaced.
		w.Header().Set("Cache-Control", revalidate)
	case strings.HasPrefix(name, "assets/"):
		w.Header().Set("Cache-Control", immutableCache)
	case strings.HasPrefix(name, "ffmpeg/"):
		// The SPA appends the core version as a query string; the file name
		// itself never changes, so it is safe to keep it for a year.
		w.Header().Set("Cache-Control", immutableCache)
	default:
		w.Header().Set("Cache-Control", revalidate)
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// looksLikeAsset reports whether a path is a static script or style file that
// must never be answered with the SPA shell. The list is intentionally narrow:
// client-side routes may contain dots, but they do not end in these extensions.
func looksLikeAsset(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".js", ".mjs", ".css", ".wasm":
		return true
	default:
		return false
	}
}
