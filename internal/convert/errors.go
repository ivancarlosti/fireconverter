package convert

import (
	"errors"
	"fmt"
)

// Sentinel errors the HTTP layer maps to stable codes and statuses.
var (
	ErrUnsupportedOutput = errors.New("unsupported output format")
	ErrNoVideoStream     = errors.New("the file has no video stream")
	ErrNoAudioStream     = errors.New("the file has no audio stream")
	ErrTargetUnsupported = errors.New("this output format cannot hit a target size")
	ErrDurationUnknown   = errors.New("the duration of the file is unknown")
	ErrProbeFailed       = errors.New("the file could not be inspected")
	ErrFFmpegMissing     = errors.New("ffmpeg is not available on this server")
	ErrEmptyOutput       = errors.New("ffmpeg produced an empty file")
)

// TargetTooSmallError carries the smallest target the input can reach.
type TargetTooSmallError struct {
	MinTargetBytes int64
}

func (e *TargetTooSmallError) Error() string {
	return fmt.Sprintf("the target size is too small for this file (minimum %.1f MB)", float64(e.MinTargetBytes)/(1000*1000))
}

// EncoderError carries the tail of ffmpeg's stderr so the UI can show a useful
// technical detail without leaking server paths (the tail is produced from the
// command's own output).
type EncoderError struct {
	Tail string
}

func (e *EncoderError) Error() string {
	if e.Tail == "" {
		return "the encoder failed"
	}
	return fmt.Sprintf("the encoder failed: %s", e.Tail)
}
