package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ivancarlosti/fireconverter/internal/convert"
)

// Submit validates an upload, stores it, probes it and queues it. A target-size
// job stops at StatusAwaiting for the review dialog.
func (m *Manager) Submit(reader io.Reader, fileName string, opts Options) (*Job, error) {
	if !m.available {
		return nil, convert.ErrFFmpegMissing
	}
	if m.ctx == nil {
		return nil, ErrNotReady
	}

	ext := convert.ExtOf(fileName)
	kind, ok := convert.KindOf(ext)
	if !ok {
		return nil, fmt.Errorf("%w: .%s", convert.ErrUnsupportedOutput, ext)
	}
	if kind == convert.KindImage {
		return nil, ErrImageLocal
	}
	output, ok := convert.OutputOf(opts.Output)
	if !ok || !outputAllowed(kind, output.Kind) {
		return nil, fmt.Errorf("%w: %s", convert.ErrUnsupportedOutput, opts.Output)
	}
	if opts.TargetBytes > 0 {
		if !convert.TargetSizeSupported(kind, output.Ext) {
			return nil, convert.ErrTargetUnsupported
		}
		if opts.TargetBytes > m.cfg.TargetSizeMaxBytes {
			return nil, &TargetTooLargeError{LimitBytes: m.cfg.TargetSizeMaxBytes}
		}
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	active := 0
	for _, job := range m.jobs {
		if job.clientIP == opts.ClientIP && !job.terminal() {
			active++
		}
	}
	if active >= m.cfg.MaxJobsPerIP {
		return nil, ErrBusy
	}

	id, err := newID()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(m.cfg.WorkDir, id)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("jobs: creating the work directory: %w", err)
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(dir)
		}
	}()

	inputPath := filepath.Join(dir, "input."+ext)
	inputFile, err := os.Create(inputPath)
	if err != nil {
		return nil, fmt.Errorf("jobs: storing the upload: %w", err)
	}
	written, copyErr := io.Copy(inputFile, io.LimitReader(reader, m.cfg.MaxUploadBytes+1))
	closeErr := inputFile.Close()
	if copyErr != nil {
		return nil, fmt.Errorf("jobs: storing the upload: %w", copyErr)
	}
	if closeErr != nil {
		return nil, fmt.Errorf("jobs: storing the upload: %w", closeErr)
	}
	if written == 0 {
		return nil, ErrEmptyFile
	}
	if written > m.cfg.MaxUploadBytes {
		return nil, &TooLargeError{LimitBytes: m.cfg.MaxUploadBytes}
	}

	probeCtx, cancel := context.WithTimeout(m.ctx, 30*time.Second)
	probe, err := convert.ProbeFile(probeCtx, m.ffprobePath, inputPath)
	cancel()
	if err != nil {
		return nil, err
	}
	if probe.Duration > float64(m.cfg.MaxDurationSeconds) {
		return nil, &TooLongError{LimitSeconds: m.cfg.MaxDurationSeconds}
	}
	if err := probe.ValidateFor(kind, output.Ext); err != nil {
		return nil, err
	}

	var plan *convert.Plan
	if opts.TargetBytes > 0 {
		plan, err = convert.BuildPlan(kind, output.Ext, probe, opts.TargetBytes, opts.AudioKbps, opts.Scale, opts.FPS)
		if err != nil {
			return nil, err
		}
	}

	displayName := sanitizeName(filepath.Base(fileName))
	base := strings.TrimSuffix(displayName, filepath.Ext(displayName))
	if base == "" || base == "." {
		base = "converted"
	}
	outputName := base + "-converted." + output.Ext

	now := time.Now().UTC()
	job := &Job{
		ID:            id,
		Status:        StatusQueued,
		Stage:         "queued",
		FileName:      displayName,
		Kind:          kind,
		Output:        output.Ext,
		OutputName:    outputName,
		InputSize:     written,
		Probe:         probe,
		Plan:          plan,
		CreatedAt:     now,
		UpdatedAt:     now,
		RequestedCRF:  opts.CRF,
		RequestedKbps: opts.AudioKbps,
		Scale:         opts.Scale,
		FPS:           opts.FPS,
		dir:           dir,
		inputPath:     inputPath,
		outputPath:    filepath.Join(dir, "output."+output.Ext),
		clientIP:      opts.ClientIP,
	}
	if plan != nil {
		job.Status = StatusAwaiting
		job.Stage = "awaiting_confirmation"
	}

	m.jobs[id] = job
	if plan != nil {
		cleanup = false
		return job, nil
	}
	if err := m.enqueueLocked(job); err != nil {
		delete(m.jobs, id)
		return nil, err
	}
	cleanup = false
	return job, nil
}

// outputAllowed reports whether an output category can be produced from a kind.
func outputAllowed(input, output convert.Kind) bool {
	if input == convert.KindVideo {
		return output == convert.KindVideo || output == convert.KindAudio
	}
	return input == output
}

// enqueueLocked sends a job to the workers. The caller holds m.mu.
func (m *Manager) enqueueLocked(job *Job) error {
	select {
	case m.queue <- job:
		return nil
	case <-m.ctx.Done():
		return ErrNotReady
	default:
		return ErrBusy
	}
}

func newID() (string, error) {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("jobs: generating an identifier: %w", err)
	}
	return hex.EncodeToString(buffer), nil
}

// sanitizeName removes path separators, control characters and characters a
// Content-Disposition header cannot carry.
func sanitizeName(name string) string {
	name = strings.TrimSpace(name)
	var builder strings.Builder
	for _, r := range name {
		switch {
		case r < 32 || r == 127:
			continue
		case strings.ContainsRune(`/\:*?"<>|`, r):
			builder.WriteRune('_')
		default:
			builder.WriteRune(r)
		}
		if utf8.RuneCountInString(builder.String()) >= 160 {
			break
		}
	}
	return strings.TrimSpace(builder.String())
}
