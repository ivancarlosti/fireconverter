package convert

import (
	"fmt"
	"math"
)

// Plan is the reviewable target-size calculation. It is also the JSON the SPA
// shows in the confirmation dialog.
type Plan struct {
	TargetBytes      int64    `json:"target_bytes"`
	TargetMB         float64  `json:"target_mb"`
	DurationSeconds  float64  `json:"duration_seconds"`
	VideoBitrateKbps int      `json:"video_bitrate_kbps,omitempty"`
	AudioBitrateKbps int      `json:"audio_bitrate_kbps,omitempty"`
	Passes           int      `json:"passes"`
	EstimatedBytes   int64    `json:"estimated_bytes"`
	MinTargetBytes   int64    `json:"min_target_bytes,omitempty"`
	Width            int      `json:"width,omitempty"`
	Height           int      `json:"height,omitempty"`
	FPS              float64  `json:"fps,omitempty"`
	Scale            string   `json:"scale,omitempty"`
	Warnings         []string `json:"warnings,omitempty"`
}

const (
	// containerOverhead reserves room for the muxer and frame indexing.
	containerOverhead = 0.97
	// minVideoKbps is the floor below which the result is not worth encoding.
	minVideoKbps = 50
	// minAudioKbps is the floor of a lossy audio target.
	minAudioKbps = 8
	// maxAudioKbps keeps a target-size audio file within a sane ceiling.
	maxAudioKbps = 320
)

// BuildPlan turns a target byte count into bitrates for an output.
//
// For audio the whole target is the audio bitrate. For video the audio track is
// reserved first (the requested bitrate, capped at a quarter of the budget) and
// the rest goes to the video encoder. The result is a plan, not a guarantee:
// the runner verifies the encoded size and retries once when it overshoots.
func BuildPlan(kind Kind, out string, probe *Probe, targetBytes int64, audioKbps int, scale string, fps float64) (*Plan, error) {
	if targetBytes <= 0 {
		return nil, fmt.Errorf("%w: the target size must be positive", ErrTargetUnsupported)
	}
	if !TargetSizeSupported(kind, out) {
		return nil, ErrTargetUnsupported
	}
	if probe == nil || probe.Duration <= 0 {
		return nil, ErrDurationUnknown
	}

	duration := probe.Duration
	plan := &Plan{
		TargetBytes:     targetBytes,
		TargetMB:        roundMB(targetBytes),
		DurationSeconds: duration,
		Passes:          1,
		Scale:           scale,
		FPS:             fps,
	}
	if probe.Video != nil {
		plan.Width = probe.Video.Width
		plan.Height = probe.Video.Height
		if plan.FPS <= 0 {
			plan.FPS = probe.Video.FPS
		}
	}

	totalKbps := float64(targetBytes) * 8 / duration / 1000 * containerOverhead
	if totalKbps < 1 {
		return nil, &TargetTooSmallError{MinTargetBytes: minimumBytes(kind, audioKbps, duration)}
	}

	if kind == KindAudio {
		bitrate := int(math.Floor(totalKbps))
		if bitrate < minAudioKbps {
			return nil, &TargetTooSmallError{MinTargetBytes: minimumBytes(kind, 0, duration)}
		}
		if bitrate > maxAudioKbps {
			bitrate = maxAudioKbps
			plan.Warnings = append(plan.Warnings, "target_above_codec_max")
		}
		plan.AudioBitrateKbps = bitrate
		plan.EstimatedBytes = estimateBytes(0, bitrate, duration)
		return plan, nil
	}

	audio := 0
	if probe.HasAudio {
		audio = audioKbps
		if audio <= 0 {
			audio = AudioDefaults(kind, out)
		}
		ceiling := int(math.Floor(totalKbps * 0.25))
		if ceiling < 32 {
			ceiling = 32
		}
		if audio > ceiling {
			audio = ceiling
		}
		if audio > maxAudioKbps {
			audio = maxAudioKbps
		}
		if audio < 32 {
			audio = 0 // too little room for a second track
		}
	}

	video := int(math.Floor(totalKbps)) - audio
	if video < minVideoKbps {
		return nil, &TargetTooSmallError{MinTargetBytes: minimumBytes(kind, audio, duration)}
	}
	if video > 100000 {
		plan.Warnings = append(plan.Warnings, "bitrate_very_high")
	}
	if probe.Size > 0 && targetBytes >= probe.Size {
		plan.Warnings = append(plan.Warnings, "target_larger_than_source")
	}

	plan.VideoBitrateKbps = video
	plan.AudioBitrateKbps = audio
	plan.Passes = 2
	plan.EstimatedBytes = estimateBytes(video, audio, duration)
	return plan, nil
}

// minimumBytes is the smallest target that still allows a meaningful encode.
func minimumBytes(kind Kind, audioKbps int, duration float64) int64 {
	kbps := minAudioKbps
	if kind == KindVideo {
		kbps = minVideoKbps + audioKbps
	}
	bytes := float64(kbps) * 1000 / 8 * duration / containerOverhead
	return int64(math.Ceil(bytes))
}

// estimateBytes projects the muxed size of a bitrate pair.
func estimateBytes(videoKbps, audioKbps int, duration float64) int64 {
	bytes := float64(videoKbps+audioKbps) * 1000 / 8 * duration / containerOverhead
	return int64(math.Ceil(bytes))
}

// roundMB renders a byte count in decimal megabytes with one decimal.
func roundMB(bytes int64) float64 {
	return math.Round(float64(bytes)/(1000*1000)*10) / 10
}
