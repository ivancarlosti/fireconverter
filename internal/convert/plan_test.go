package convert

import (
	"errors"
	"math"
	"testing"
)

func videoProbe(duration, size float64) *Probe {
	return &Probe{
		Duration: duration,
		Size:     int64(size),
		HasVideo: true,
		HasAudio: true,
		Video:    &VideoInfo{Width: 1920, Height: 1080, FPS: 30},
		Audio:    &AudioInfo{Channels: 2, SampleRate: 48000},
	}
}

func TestBuildPlanVideoFitsTarget(t *testing.T) {
	probe := videoProbe(60, 50_000_000)
	target := int64(10 * 1000 * 1000)
	plan, err := BuildPlan(KindVideo, "mp4", probe, target, 128, "1280x720", 30)
	if err != nil {
		t.Fatalf("BuildPlan returned %v", err)
	}
	if plan.Passes != 2 {
		t.Fatalf("video target should use two passes, got %d", plan.Passes)
	}
	if plan.VideoBitrateKbps < minVideoKbps {
		t.Fatalf("video bitrate too low: %d", plan.VideoBitrateKbps)
	}
	if plan.AudioBitrateKbps != 128 {
		t.Fatalf("audio bitrate = %d, want 128", plan.AudioBitrateKbps)
	}
	if plan.EstimatedBytes > target {
		t.Fatalf("estimated %d bytes exceeds target %d", plan.EstimatedBytes, target)
	}
	if plan.Scale != "1280x720" || plan.Width != 1920 || plan.Height != 1080 {
		t.Fatalf("unexpected scale metadata: %+v", plan)
	}
}

func TestBuildPlanAudio(t *testing.T) {
	probe := videoProbe(60, 10_000_000)
	probe.Video = nil
	probe.HasVideo = false
	plan, err := BuildPlan(KindAudio, "mp3", probe, 1_000_000, 0, "", 0)
	if err != nil {
		t.Fatalf("BuildPlan returned %v", err)
	}
	if plan.Passes != 1 {
		t.Fatalf("audio target should use one pass, got %d", plan.Passes)
	}
	// 1 MB over 60 s leaves ~129 kbps after the container reserve.
	if plan.AudioBitrateKbps < 125 || plan.AudioBitrateKbps > 135 {
		t.Fatalf("audio bitrate = %d, want about 129", plan.AudioBitrateKbps)
	}
}

func TestBuildPlanRejectsTinyTarget(t *testing.T) {
	probe := videoProbe(600, 100_000_000)
	_, err := BuildPlan(KindVideo, "mp4", probe, 100_000, 128, "", 0)
	var tooSmall *TargetTooSmallError
	if !errors.As(err, &tooSmall) {
		t.Fatalf("want TargetTooSmallError, got %v", err)
	}
	if tooSmall.MinTargetBytes <= 100_000 {
		t.Fatalf("minimum target %d should exceed the requested 100000", tooSmall.MinTargetBytes)
	}
}

func TestBuildPlanRejectsLosslessTarget(t *testing.T) {
	probe := videoProbe(60, 10_000_000)
	if _, err := BuildPlan(KindAudio, "flac", probe, 1_000_000, 0, "", 0); !errors.Is(err, ErrTargetUnsupported) {
		t.Fatalf("want ErrTargetUnsupported, got %v", err)
	}
}

func TestBuildPlanRejectsUnknownDuration(t *testing.T) {
	probe := videoProbe(0, 10_000_000)
	if _, err := BuildPlan(KindVideo, "mp4", probe, 1_000_000, 0, "", 0); !errors.Is(err, ErrDurationUnknown) {
		t.Fatalf("want ErrDurationUnknown, got %v", err)
	}
}

func TestBuildPlanWarnsWhenTargetExceedsSource(t *testing.T) {
	probe := videoProbe(10, 1_000_000)
	plan, err := BuildPlan(KindVideo, "mp4", probe, 5_000_000, 128, "", 0)
	if err != nil {
		t.Fatalf("BuildPlan returned %v", err)
	}
	found := false
	for _, warning := range plan.Warnings {
		if warning == "target_larger_than_source" {
			found = true
		}
	}
	if !found {
		t.Fatalf("warnings = %v, want target_larger_than_source", plan.Warnings)
	}
}

func TestEstimateNeverNegative(t *testing.T) {
	if got := estimateBytes(0, 0, -1); got != 0 && got < 0 {
		t.Fatalf("estimateBytes returned %d", got)
	}
	if math.IsNaN(roundMB(0)) {
		t.Fatal("roundMB returned NaN")
	}
}
