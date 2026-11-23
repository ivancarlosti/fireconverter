package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func newSPAHandler() http.Handler {
	assets := fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte("<!doctype html><title>FireConverter</title>"),
		},
		"sw.js": &fstest.MapFile{
			Data: []byte("self.registration.unregister();"),
		},
		"assets/app-abc123.js": &fstest.MapFile{
			Data: []byte("console.log('app');"),
		},
	}
	return (&Server{assets: assets}).spa()
}

func TestSPAServesServiceWorker(t *testing.T) {
	handler := newSPAHandler()
	for _, target := range []string{"/sw.js", "/sw.js?v=legacy"} {
		t.Run(target, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))

			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
			}
			if got := recorder.Header().Get("Content-Type"); got != "text/javascript; charset=utf-8" {
				t.Errorf("Content-Type = %q", got)
			}
			if got := recorder.Header().Get("Cache-Control"); got != revalidate {
				t.Errorf("Cache-Control = %q, want %q", got, revalidate)
			}
			if body := recorder.Body.String(); !strings.Contains(body, "registration.unregister") {
				t.Errorf("body = %q, want the cleanup worker", body)
			}
		})
	}
}

func TestSPAServesImmutableHashedAssets(t *testing.T) {
	recorder := httptest.NewRecorder()
	newSPAHandler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/assets/app-abc123.js", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if got := recorder.Header().Get("Content-Type"); got != "text/javascript; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}
	if got := recorder.Header().Get("Cache-Control"); got != immutableCache {
		t.Errorf("Cache-Control = %q, want %q", got, immutableCache)
	}
}

func TestSPAMissingScriptIsNotFound(t *testing.T) {
	for _, target := range []string{
		"/assets/removed.js",
		"/assets/removed.mjs",
		"/assets/removed.css",
		"/ffmpeg/ffmpeg-core.wasm",
	} {
		t.Run(target, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			newSPAHandler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))

			if recorder.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
			}
			if got := recorder.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
				t.Errorf("Content-Type = %q", got)
			}
			if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
				t.Errorf("Cache-Control = %q, want no-store", got)
			}
			if body := recorder.Body.String(); !strings.Contains(body, "asset not found") {
				t.Errorf("body = %q, want an asset 404", body)
			}
		})
	}
}

func TestSPAFallsBackToIndex(t *testing.T) {
	recorder := httptest.NewRecorder()
	newSPAHandler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/convert/video", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if got := recorder.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}
	if got := recorder.Header().Get("Cache-Control"); got != revalidate {
		t.Errorf("Cache-Control = %q, want %q", got, revalidate)
	}
	if body := recorder.Body.String(); !strings.Contains(body, "<title>FireConverter</title>") {
		t.Errorf("body = %q, want index.html", body)
	}
}
