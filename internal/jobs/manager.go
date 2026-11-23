package jobs

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/ivancarlosti/fireconverter/internal/config"
)

// Errors the HTTP layer maps to stable codes and statuses.
var (
	ErrBusy         = errors.New("the server is busy, try again in a moment")
	ErrNotFound     = errors.New("job not found")
	ErrEmptyFile    = errors.New("the uploaded file is empty")
	ErrImageLocal   = errors.New("images are converted in the browser")
	ErrNotReady     = errors.New("the job manager is not running")
	ErrInvalidState = errors.New("the job is not waiting for confirmation")
)

// TooLargeError reports the upload ceiling.
type TooLargeError struct{ LimitBytes int64 }

func (e *TooLargeError) Error() string {
	return fmt.Sprintf("the file is larger than the %d MB limit", e.LimitBytes/(1024*1024))
}

// TooLongError reports the duration ceiling.
type TooLongError struct{ LimitSeconds int }

func (e *TooLongError) Error() string {
	return fmt.Sprintf("the file is longer than the %d second limit", e.LimitSeconds)
}

// TargetTooLargeError reports the target-size ceiling.
type TargetTooLargeError struct{ LimitBytes int64 }

func (e *TargetTooLargeError) Error() string {
	return fmt.Sprintf("the target size is larger than the %d MB limit", e.LimitBytes/(1024*1024))
}

// Options is one validated upload.
type Options struct {
	Output      string
	TargetBytes int64
	AudioKbps   int
	CRF         int
	Scale       string
	FPS         float64
	ClientIP    string
}

// Manager owns the job map, the queue and the ffmpeg availability check.
type Manager struct {
	cfg *config.Config

	ffmpegPath    string
	ffprobePath   string
	ffmpegVersion string
	available     bool

	mu    sync.Mutex
	jobs  map[string]*Job
	queue chan *Job

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// New creates the manager and checks the encoder binaries.
func New(cfg *config.Config) *Manager {
	manager := &Manager{
		cfg:         cfg,
		ffmpegPath:  cfg.FFmpegPath,
		ffprobePath: cfg.FFprobePath,
		jobs:        make(map[string]*Job),
		queue:       make(chan *Job, 128),
	}
	ffmpegVersion, ffmpegErr := binaryVersion(cfg.FFmpegPath)
	_, ffprobeErr := binaryVersion(cfg.FFprobePath)
	manager.available = ffmpegErr == nil && ffprobeErr == nil
	manager.ffmpegVersion = ffmpegVersion
	return manager
}

// Available reports whether the server can encode.
func (m *Manager) Available() bool { return m.available }

// FFmpegVersion is the first line of `ffmpeg -version` (empty when missing).
func (m *Manager) FFmpegVersion() string { return m.ffmpegVersion }

// Get returns one job.
func (m *Manager) Get(id string) (*Job, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	job, ok := m.jobs[id]
	return job, ok
}

// binaryVersion returns the first line of `<binary> -version`.
func binaryVersion(path string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, "-version").CombinedOutput()
	if err != nil {
		return "", err
	}
	line := strings.SplitN(strings.TrimSpace(string(output)), "\n", 2)[0]
	if idx := strings.Index(line, " Copyright"); idx > 0 {
		line = line[:idx]
	}
	if len(line) > 160 {
		line = line[:160]
	}
	return line, nil
}
