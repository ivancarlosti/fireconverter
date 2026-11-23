package handlers

import (
	"io/fs"
	"net/http"
	"time"

	"github.com/ivancarlosti/fireconverter/internal/config"
	"github.com/ivancarlosti/fireconverter/internal/jobs"
	"github.com/ivancarlosti/fireconverter/internal/version"
)

// Server holds the dependencies of the HTTP layer.
type Server struct {
	cfg     *config.Config
	jobs    *jobs.Manager
	assets  fs.FS
	started time.Time
}

// New builds the HTTP layer.
func New(cfg *config.Config, manager *jobs.Manager, assets fs.FS) *Server {
	return &Server{cfg: cfg, jobs: manager, assets: assets, started: time.Now()}
}

// Handler returns the complete handler tree.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/version", s.handleVersion)
	mux.HandleFunc("GET /api/formats", s.handleFormats)

	mux.HandleFunc("POST /api/jobs", s.handleCreateJob)
	mux.HandleFunc("GET /api/jobs/{id}", s.handleGetJob)
	mux.HandleFunc("POST /api/jobs/{id}/confirm", s.handleConfirmJob)
	mux.HandleFunc("POST /api/jobs/{id}/cancel", s.handleCancelJob)
	mux.HandleFunc("GET /api/jobs/{id}/download", s.handleDownloadJob)
	mux.HandleFunc("DELETE /api/jobs/{id}", s.handleDeleteJob)

	mux.Handle("/", s.spa())

	return s.middleware(mux)
}

// buildInfo is the version payload used by health and version.
func buildInfo() version.Info {
	return version.Get()
}
