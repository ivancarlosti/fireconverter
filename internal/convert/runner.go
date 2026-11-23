package convert

import (
	"context"
	"errors"
	"fmt"
	"os"
)

// ErrTargetMissed means the encoder could not land at or below the cap even
// after the verification retry.
var ErrTargetMissed = errors.New("the output could not fit the target size")

// Request is one server-side conversion.
type Request struct {
	InputPath  string
	OutputPath string
	Kind       Kind
	Output     string
	Probe      *Probe
	Plan       *Plan
	CRF        int
	AudioKbps  int
	Scale      string
	FPS        float64
	// OnProgress receives 0..100 and a stage label ("pass1", "pass2", "encode").
	OnProgress func(percent float64, stage string)
}

// Result reports what the encoder produced.
type Result struct {
	OutputSize int64
	Retried    bool
	Warnings   []string
}

// Run executes the conversion, verifying a target-size result and retrying once
// with a reduced bitrate when the muxer overshoots.
func Run(ctx context.Context, ffmpegPath string, req Request) (*Result, error) {
	if req.Probe == nil {
		return nil, ErrProbeFailed
	}
	if err := req.Probe.ValidateFor(req.Kind, req.Output); err != nil {
		return nil, err
	}
	if _, err := codecsFor(req.Output); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrUnsupportedOutput, req.Output)
	}

	attempts := 1
	if req.Plan != nil {
		attempts = 2 // one verification retry
	}

	result := &Result{}
	scale := 1.0
	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 {
			// 15% below the plan leaves room for muxing variance.
			scale = 0.85
			result.Retried = true
		}
		_ = os.Remove(req.OutputPath)

		var err error
		switch {
		case req.Plan != nil:
			err = runTarget(ctx, ffmpegPath, req, scale, attempt)
		case req.Kind == KindAudio || req.Output == "mp3":
			err = runAudio(ctx, ffmpegPath, req, 0)
		default:
			err = runVideo(ctx, ffmpegPath, req)
		}
		if err != nil {
			_ = os.Remove(req.OutputPath)
			return nil, err
		}

		info, err := os.Stat(req.OutputPath)
		if err != nil || info.Size() == 0 {
			_ = os.Remove(req.OutputPath)
			return nil, ErrEmptyOutput
		}
		result.OutputSize = info.Size()

		if req.Plan == nil || req.Plan.TargetBytes <= 0 || info.Size() <= req.Plan.TargetBytes {
			return result, nil
		}
	}

	_ = os.Remove(req.OutputPath)
	return result, fmt.Errorf("%w: the result stayed above %.1f MB", ErrTargetMissed, float64(req.Plan.TargetBytes)/(1000*1000))
}
