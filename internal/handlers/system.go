package handlers

import (
	"net/http"
	"time"

	"github.com/ivancarlosti/fireconverter/internal/convert"
	"github.com/ivancarlosti/fireconverter/internal/version"
)

// healthView is the payload of GET /api/health.
type healthView struct {
	Status             string       `json:"status"`
	Version            version.Info `json:"version"`
	ServerConversion   bool         `json:"server_conversion"`
	FFmpegVersion      string       `json:"ffmpeg_version,omitempty"`
	MaxUploadBytes     int64        `json:"max_upload_bytes"`
	MaxDurationSeconds int          `json:"max_duration_seconds"`
	TargetSizeMaxBytes int64        `json:"target_size_max_bytes"`
	JobTTLSeconds      int          `json:"job_ttl_seconds"`
	MaxConcurrentJobs  int          `json:"max_concurrent_jobs"`
	MaxJobsPerIP       int          `json:"max_jobs_per_ip"`
	UptimeSeconds      int64        `json:"uptime_seconds"`
	Locales            []string     `json:"locales"`
	Themes             []string     `json:"themes"`
}

// SupportedLocales lists the catalogs shipped by the SPA.
var SupportedLocales = []string{"en-US", "pt-BR", "es-MX", "fr-FR", "h-CN", "hi-IN", "ar-SA"}

// SupportedThemes lists the theme preferences the SPA understands.
var SupportedThemes = []string{"light", "dark", "system"}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthView{
		Status:             "ok",
		Version:            buildInfo(),
		ServerConversion:   s.jobs.Available(),
		FFmpegVersion:      s.jobs.FFmpegVersion(),
		MaxUploadBytes:     s.cfg.MaxUploadBytes,
		MaxDurationSeconds: s.cfg.MaxDurationSeconds,
		TargetSizeMaxBytes: s.cfg.TargetSizeMaxBytes,
		JobTTLSeconds:      int(s.cfg.JobTTL.Seconds()),
		MaxConcurrentJobs:  s.cfg.MaxConcurrentJobs,
		MaxJobsPerIP:       s.cfg.MaxJobsPerIP,
		UptimeSeconds:      int64(time.Since(s.started).Seconds()),
		Locales:            SupportedLocales,
		Themes:             SupportedThemes,
	})
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"info":              buildInfo(),
		"server_conversion": s.jobs.Available(),
		"ffmpeg_version":    s.jobs.FFmpegVersion(),
		"locales":           SupportedLocales,
		"themes":            SupportedThemes,
	})
}

// formatView adds the target-size capability to a format.
type formatView struct {
	convert.Format
	TargetSize bool `json:"target_size"`
}

func (s *Server) handleFormats(w http.ResponseWriter, _ *http.Request) {
	outputs := make([]formatView, 0, len(convert.Outputs))
	for _, format := range convert.Outputs {
		outputs = append(outputs, formatView{
			Format:     format,
			TargetSize: convert.TargetSizeSupported(format.Kind, format.Ext),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"outputs":           outputs,
		"input_extensions":  convert.InputExtensions(),
		"server_conversion": s.jobs.Available(),
		"limits": map[string]any{
			"max_upload_bytes":      s.cfg.MaxUploadBytes,
			"max_duration_seconds":  s.cfg.MaxDurationSeconds,
			"target_size_max_bytes": s.cfg.TargetSizeMaxBytes,
			"max_concurrent_jobs":   s.cfg.MaxConcurrentJobs,
			"max_jobs_per_ip":       s.cfg.MaxJobsPerIP,
			"job_ttl_seconds":       int(s.cfg.JobTTL.Seconds()),
		},
	})
}
