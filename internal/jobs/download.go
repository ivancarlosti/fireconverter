package jobs

import (
	"context"
	"errors"
	"os"
	"time"

	"github.com/ivancarlosti/fireconverter/internal/convert"
)

// Download describes a finished output.
type Download struct {
	Path     string
	Name     string
	MIME     string
	Size     int64
	Modified time.Time
}

// Download returns the file of a finished job.
func (m *Manager) Download(id string) (*Download, error) {
	job, ok := m.Get(id)
	if !ok {
		return nil, ErrNotFound
	}
	job.mu.RLock()
	status := job.Status
	path := job.outputPath
	name := job.OutputName
	output := job.Output
	job.mu.RUnlock()
	if status != StatusDone {
		return nil, ErrInvalidState
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, ErrNotFound
	}
	return &Download{
		Path:     path,
		Name:     name,
		MIME:     convert.MIMEOf(output),
		Size:     info.Size(),
		Modified: info.ModTime(),
	}, nil
}

// cleaner erases jobs that outlived the TTL. Running encodes are never swept.
func (m *Manager) cleaner() {
	defer m.wg.Done()
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
			m.sweep()
		}
	}
}

func (m *Manager) sweep() {
	cutoff := time.Now().UTC().Add(-m.cfg.JobTTL)
	var directories []string

	m.mu.Lock()
	for id, job := range m.jobs {
		job.mu.RLock()
		status := job.Status
		updated := job.UpdatedAt
		dir := job.dir
		job.mu.RUnlock()
		if status == StatusRunning {
			continue
		}
		if updated.Before(cutoff) {
			delete(m.jobs, id)
			if dir != "" {
				directories = append(directories, dir)
			}
		}
	}
	m.mu.Unlock()

	for _, dir := range directories {
		_ = os.RemoveAll(dir)
	}
}

// errorCode maps a conversion failure to the stable code the SPA translates.
func errorCode(err error) string {
	var tooSmall *convert.TargetTooSmallError
	var encoder *convert.EncoderError
	switch {
	case errors.As(err, &tooSmall):
		return "target_too_small"
	case errors.Is(err, convert.ErrTargetMissed):
		return "target_missed"
	case errors.Is(err, convert.ErrTargetUnsupported):
		return "target_unsupported"
	case errors.Is(err, convert.ErrNoAudioStream):
		return "no_audio"
	case errors.Is(err, convert.ErrNoVideoStream):
		return "no_video"
	case errors.Is(err, convert.ErrDurationUnknown):
		return "duration_unknown"
	case errors.Is(err, convert.ErrUnsupportedOutput):
		return "unsupported"
	case errors.As(err, &encoder):
		return "encode_failed"
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return "canceled"
	default:
		return "internal"
	}
}

// errorMessage keeps a useful detail for the UI without leaking internal paths.
func errorMessage(err error) string {
	var encoder *convert.EncoderError
	if errors.As(err, &encoder) {
		return encoder.Error()
	}
	var tooSmall *convert.TargetTooSmallError
	if errors.As(err, &tooSmall) {
		return tooSmall.Error()
	}
	switch {
	case errors.Is(err, convert.ErrTargetMissed):
		return err.Error()
	case errors.Is(err, convert.ErrNoAudioStream):
		return "the input has no audio track"
	case errors.Is(err, convert.ErrNoVideoStream):
		return "the input has no video track"
	case errors.Is(err, convert.ErrDurationUnknown):
		return "the duration of the input could not be read"
	default:
		return "the encoder failed unexpectedly"
	}
}
