package handlers

import (
	"encoding/json"
	"mime"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/ivancarlosti/fireconverter/internal/jobs"
)

// uploadSettings is the JSON part of POST /api/jobs.
type uploadSettings struct {
	Output    string  `json:"output"`
	TargetMB  float64 `json:"target_mb"`
	AudioKbps int     `json:"audio_kbps"`
	Quality   string  `json:"quality"`
	Scale     string  `json:"scale"`
	FPS       float64 `json:"fps"`
}

var (
	jobIDPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
	scalePattern = regexp.MustCompile(`^[0-9]{2,5}x[0-9]{2,5}$`)
	qualityToCRF = map[string]int{"high": 18, "balanced": 23, "small": 28}
)

// handleCreateJob accepts a multipart upload and either queues it or stops at
// the target-size review step.
func (s *Server) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadBytes+(2<<20))
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		fail(w, err)
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "validation", "the multipart field \"file\" is required")
		return
	}
	defer file.Close()

	var settings uploadSettings
	rawSettings := r.FormValue("settings")
	if rawSettings == "" {
		writeError(w, http.StatusBadRequest, "validation", "the multipart field \"settings\" is required")
		return
	}
	if err := json.Unmarshal([]byte(rawSettings), &settings); err != nil {
		writeError(w, http.StatusBadRequest, "validation", "settings is not valid JSON: "+err.Error())
		return
	}

	opts, err := s.optionsFromSettings(settings, r)
	if err != nil {
		fail(w, err)
		return
	}
	job, err := s.jobs.Submit(file, header.Filename, opts)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, job.Snapshot())
}

func (s *Server) optionsFromSettings(settings uploadSettings, r *http.Request) (jobs.Options, error) {
	output := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(settings.Output, ".")))
	if output == "" {
		return jobs.Options{}, &validationError{"the output format is required"}
	}
	if settings.TargetMB < 0 {
		return jobs.Options{}, &validationError{"target_mb must not be negative"}
	}
	if settings.TargetMB > 0 && settings.TargetMB < 0.05 {
		return jobs.Options{}, &validationError{"target_mb must be at least 0.05"}
	}
	if settings.TargetMB > float64(s.cfg.TargetSizeMaxBytes)/(1000*1000) {
		return jobs.Options{}, &validationError{"target_mb exceeds the instance limit"}
	}
	if settings.AudioKbps < 0 || settings.AudioKbps > 512 {
		return jobs.Options{}, &validationError{"audio_kbps must be between 0 and 512"}
	}
	if settings.FPS < 0 || settings.FPS > 240 {
		return jobs.Options{}, &validationError{"fps must be between 0 and 240"}
	}
	scale := strings.ToLower(strings.TrimSpace(settings.Scale))
	if scale != "" && !scalePattern.MatchString(scale) {
		return jobs.Options{}, &validationError{"scale must look like 1280x720"}
	}
	crf := 23
	if settings.Quality != "" {
		value, ok := qualityToCRF[settings.Quality]
		if !ok {
			return jobs.Options{}, &validationError{"quality must be high, balanced or small"}
		}
		crf = value
	}
	return jobs.Options{
		Output:      output,
		TargetBytes: int64(settings.TargetMB * 1000 * 1000),
		AudioKbps:   settings.AudioKbps,
		CRF:         crf,
		Scale:       scale,
		FPS:         settings.FPS,
		ClientIP:    clientIP(r, s.cfg.TrustProxy),
	}, nil
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	job, ok := s.jobFromPath(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, job.Snapshot())
}

func (s *Server) handleConfirmJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !jobIDPattern.MatchString(id) {
		fail(w, jobs.ErrNotFound)
		return
	}
	if err := s.jobs.Confirm(id); err != nil {
		fail(w, err)
		return
	}
	job, ok := s.jobs.Get(id)
	if !ok {
		fail(w, jobs.ErrNotFound)
		return
	}
	writeJSON(w, http.StatusOK, job.Snapshot())
}

func (s *Server) handleCancelJob(w http.ResponseWriter, r *http.Request) {
	job, ok := s.jobFromPath(w, r)
	if !ok {
		return
	}
	if !s.jobs.Cancel(job.ID) {
		fail(w, jobs.ErrInvalidState)
		return
	}
	writeJSON(w, http.StatusOK, job.Snapshot())
}

func (s *Server) handleDeleteJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !jobIDPattern.MatchString(id) {
		fail(w, jobs.ErrNotFound)
		return
	}
	if !s.jobs.Delete(id) {
		fail(w, jobs.ErrNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDownloadJob(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !jobIDPattern.MatchString(id) {
		fail(w, jobs.ErrNotFound)
		return
	}
	download, err := s.jobs.Download(id)
	if err != nil {
		fail(w, err)
		return
	}
	file, err := os.Open(download.Path)
	if err != nil {
		fail(w, jobs.ErrNotFound)
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", download.MIME)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": download.Name}))
	http.ServeContent(w, r, download.Name, download.Modified, file)
}

func (s *Server) jobFromPath(w http.ResponseWriter, r *http.Request) (*jobs.Job, bool) {
	id := r.PathValue("id")
	if !jobIDPattern.MatchString(id) {
		fail(w, jobs.ErrNotFound)
		return nil, false
	}
	job, ok := s.jobs.Get(id)
	if !ok {
		fail(w, jobs.ErrNotFound)
		return nil, false
	}
	return job, true
}

type validationError struct{ message string }

func (e *validationError) Error() string { return e.message }
