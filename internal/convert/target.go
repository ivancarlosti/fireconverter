package convert

import (
	"context"
	"fmt"
	"path/filepath"
)

// runTarget performs a two-pass target-size encode.
func runTarget(ctx context.Context, ffmpegPath string, req Request, scale float64, attempt int) error {
	plan := req.Plan
	logPrefix := filepath.Join(filepath.Dir(req.OutputPath), fmt.Sprintf("pass-%d", attempt))

	if req.Kind == KindAudio {
		kbps := int(float64(plan.AudioBitrateKbps) * scale)
		if kbps < minAudioKbps {
			kbps = minAudioKbps
		}
		return runAudio(ctx, ffmpegPath, req, kbps)
	}

	videoKbps := int(float64(plan.VideoBitrateKbps) * scale)
	if videoKbps < minVideoKbps {
		videoKbps = minVideoKbps
	}
	audioKbps := plan.AudioBitrateKbps
	if audioKbps > 0 {
		audioKbps = int(float64(audioKbps) * scale)
		if audioKbps < 32 {
			audioKbps = 32
		}
	}

	codec, err := codecsFor(req.Output)
	if err != nil {
		return err
	}
	filter := videoFilter(req.Scale)
	if filter == "" && codec.Video == "libx264" {
		// H.264 needs even dimensions; an odd source would abort the encode.
		filter = "scale=trunc(iw/2)*2:trunc(ih/2)*2"
	}

	firstPass := baseArgs(req.InputPath)
	firstPass = append(firstPass, "-map", "0:v:0", "-c:v", codec.Video)
	firstPass = append(firstPass, videoCodecArgs(codec.Video, videoKbps)...)
	if filter != "" {
		firstPass = append(firstPass, "-vf", filter)
	}
	if req.FPS > 0 {
		firstPass = append(firstPass, "-r", trimFloat(req.FPS))
	}
	firstPass = append(firstPass,
		"-pass", "1",
		"-passlogfile", logPrefix,
		"-an", "-sn", "-dn",
		"-f", "null", "/dev/null",
	)
	if err := execute(ctx, ffmpegPath, firstPass, req, 0, 49, "pass1"); err != nil {
		return err
	}

	secondPass := baseArgs(req.InputPath)
	secondPass = append(secondPass, "-map", "0:v:0")
	if req.Probe.HasAudio && audioKbps > 0 {
		secondPass = append(secondPass, "-map", "0:a:0?")
	}
	secondPass = append(secondPass, "-c:v", codec.Video)
	secondPass = append(secondPass, videoCodecArgs(codec.Video, videoKbps)...)
	if filter != "" {
		secondPass = append(secondPass, "-vf", filter)
	}
	if req.FPS > 0 {
		secondPass = append(secondPass, "-r", trimFloat(req.FPS))
	}
	secondPass = append(secondPass, "-pass", "2", "-passlogfile", logPrefix)
	if req.Probe.HasAudio && audioKbps > 0 {
		secondPass = append(secondPass, "-c:a", codec.Audio, "-b:a", fmt.Sprintf("%dk", audioKbps))
	}
	secondPass = append(secondPass, outputArgs(req.Output)...)
	secondPass = append(secondPass, req.OutputPath)
	return execute(ctx, ffmpegPath, secondPass, req, 49, 100, "pass2")
}

// videoCodecArgs is the bitrate configuration shared by the two passes.
func videoCodecArgs(encoder string, kbps int) []string {
	if encoder == "libx264" {
		return []string{
			"-preset", "medium",
			"-b:v", fmt.Sprintf("%dk", kbps),
			"-maxrate", fmt.Sprintf("%dk", int(float64(kbps)*1.45)),
			"-bufsize", fmt.Sprintf("%dk", kbps*2),
			"-pix_fmt", "yuv420p",
		}
	}
	return []string{
		"-b:v", fmt.Sprintf("%dk", kbps),
		"-row-mt", "1",
		"-deadline", "good",
		"-cpu-used", "2",
	}
}
