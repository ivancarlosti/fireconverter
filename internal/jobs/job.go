// Package jobs owns the in-memory lifecycle of server-side conversions: upload
// storage, metadata, the queue, progress, cancellation and TTL cleanup.
package jobs

import (
	"context"
	"sync"
	"time"

	"github.com/ivancarlosti/fireconverter/internal/convert"
)

// Status is the state of one job.
type Status string

const (
	StatusAwaiting Status = "awaiting_confirmation"
	StatusQueued   Status = "queued"
	StatusRunning  Status = "running"
	StatusDone     Status = "done"
	StatusFailed   Status = "failed"
	StatusCanceled Status = "canceled"
)

// Job is one server-side conversion. Every field is guarded by mu because the
// HTTP handlers read it while a worker writes progress.
type Job struct {
	mu sync.RWMutex

	ID            string
	Status        Status
	Stage         string
	Progress      float64
	FileName      string
	Kind          convert.Kind
	Output        string
	OutputName    string
	InputSize     int64
	OutputSize    int64
	Probe         *convert.Probe
	Plan          *convert.Plan
	ErrorCode     string
	ErrorMessage  string
	Warnings      []string
	CreatedAt     time.Time
	UpdatedAt     time.Time
	StartedAt     time.Time
	FinishedAt    time.Time
	Retried       bool
	RequestedCRF  int
	RequestedKbps int
	Scale         string
	FPS           float64

	dir        string
	inputPath  string
	outputPath string
	clientIP   string
	ctx        context.Context
	cancel     context.CancelFunc
}

// View is the JSON shape of a job. Internal paths never leave the process.
type View struct {
	ID           string        `json:"id"`
	Status       Status        `json:"status"`
	Stage        string        `json:"stage"`
	Progress     float64       `json:"progress"`
	FileName     string        `json:"file_name"`
	Kind         convert.Kind  `json:"kind"`
	Output       string        `json:"output"`
	OutputName   string        `json:"output_name"`
	InputSize    int64         `json:"input_size"`
	OutputSize   int64         `json:"output_size"`
	Plan         *convert.Plan `json:"plan,omitempty"`
	Probe        *ProbeView    `json:"probe,omitempty"`
	ErrorCode    string        `json:"error_code,omitempty"`
	ErrorMessage string        `json:"error_message,omitempty"`
	Warnings     []string      `json:"warnings,omitempty"`
	CreatedAt    time.Time     `json:"created_at"`
	UpdatedAt    time.Time     `json:"updated_at"`
	FinishedAt   *time.Time    `json:"finished_at,omitempty"`
	DownloadURL  string        `json:"download_url,omitempty"`
}

// ProbeView is the public subset of ffprobe metadata.
type ProbeView struct {
	DurationSeconds float64 `json:"duration_seconds"`
	Width           int     `json:"width,omitempty"`
	Height          int     `json:"height,omitempty"`
	FPS             float64 `json:"fps,omitempty"`
	HasAudio        bool    `json:"has_audio"`
}

// Snapshot returns a copy safe to serialize.
func (j *Job) Snapshot() View {
	j.mu.RLock()
	defer j.mu.RUnlock()

	view := View{
		ID:           j.ID,
		Status:       j.Status,
		Stage:        j.Stage,
		Progress:     j.Progress,
		FileName:     j.FileName,
		Kind:         j.Kind,
		Output:       j.Output,
		OutputName:   j.OutputName,
		InputSize:    j.InputSize,
		OutputSize:   j.OutputSize,
		Plan:         j.Plan,
		ErrorCode:    j.ErrorCode,
		ErrorMessage: j.ErrorMessage,
		Warnings:     append([]string(nil), j.Warnings...),
		CreatedAt:    j.CreatedAt,
		UpdatedAt:    j.UpdatedAt,
	}
	if j.Probe != nil {
		view.Probe = &ProbeView{
			DurationSeconds: j.Probe.Duration,
			HasAudio:        j.Probe.HasAudio,
		}
		if j.Probe.Video != nil {
			view.Probe.Width = j.Probe.Video.Width
			view.Probe.Height = j.Probe.Video.Height
			view.Probe.FPS = j.Probe.Video.FPS
		}
	}
	if !j.FinishedAt.IsZero() {
		finished := j.FinishedAt
		view.FinishedAt = &finished
	}
	if j.Status == StatusDone {
		view.DownloadURL = "/api/jobs/" + j.ID + "/download"
	}
	return view
}

func (j *Job) setProgress(percent float64, stage string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if percent > 100 {
		percent = 100
	}
	j.Progress = percent
	if stage != "" {
		j.Stage = stage
	}
	j.UpdatedAt = time.Now().UTC()
}

func (j *Job) begin(ctx context.Context) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.Status != StatusQueued {
		return false
	}
	jobCtx, cancel := context.WithCancel(ctx)
	j.ctx = jobCtx
	j.cancel = cancel
	j.Status = StatusRunning
	j.Stage = "starting"
	j.StartedAt = time.Now().UTC()
	j.UpdatedAt = j.StartedAt
	return true
}

func (j *Job) finish(size int64, retried bool, warnings []string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Status = StatusDone
	j.Stage = "done"
	j.Progress = 100
	j.OutputSize = size
	j.Retried = retried
	j.Warnings = append(j.Warnings, warnings...)
	if retried {
		j.Warnings = append(j.Warnings, "target_retried")
	}
	j.FinishedAt = time.Now().UTC()
	j.UpdatedAt = j.FinishedAt
}

func (j *Job) fail(code, message string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Status = StatusFailed
	j.ErrorCode = code
	j.ErrorMessage = message
	j.FinishedAt = time.Now().UTC()
	j.UpdatedAt = j.FinishedAt
}

func (j *Job) markCanceled() {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Status = StatusCanceled
	j.Stage = "canceled"
	j.FinishedAt = time.Now().UTC()
	j.UpdatedAt = j.FinishedAt
}

func (j *Job) isCanceled() bool {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.Status == StatusCanceled
}

func (j *Job) terminal() bool {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.Status == StatusDone || j.Status == StatusFailed || j.Status == StatusCanceled
}
