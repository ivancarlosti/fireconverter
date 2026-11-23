package convert

import (
	"context"
	"fmt"
	"strconv"
)

// runAudio encodes (or extracts) an audio track.
func runAudio(ctx context.Context, ffmpegPath string, req Request, kbpsOverride int) error {
	codec, err := codecsFor(req.Output)
	if err != nil {
		return err
	}
	args := baseArgs(req.InputPath)
	args = append(args, "-vn", "-sn", "-dn", "-map", "0:a:0", "-c:a", codec.Audio)

	kbps := kbpsOverride
	if kbps <= 0 {
		kbps = req.AudioKbps
	}
	if kbps <= 0 {
		kbps = AudioDefaults(req.Kind, req.Output)
	}
	if codec.Audio != "flac" && codec.Audio != "pcm_s16le" {
		args = append(args, "-b:a", fmt.Sprintf("%dk", kbps))
	}
	if codec.Muxer != "" {
		args = append(args, "-f", codec.Muxer)
	}
	args = append(args, outputArgs(req.Output)...)
	args = append(args, req.OutputPath)
	return execute(ctx, ffmpegPath, args, req, 0, 100, "encode")
}

// runVideo performs a quality-based (CRF) video encode.
func runVideo(ctx context.Context, ffmpegPath string, req Request) error {
	if req.Output == "gif" {
		return runGIF(ctx, ffmpegPath, req)
	}
	codec, err := codecsFor(req.Output)
	if err != nil {
		return err
	}
	crf := req.CRF
	if crf <= 0 {
		crf = 23
	}
	if codec.Video == "libvpx-vp9" {
		// VP9 has a 0..63 range; the x264 scale is shifted up.
		crf += 7
		if crf > 63 {
			crf = 63
		}
	}

	args := baseArgs(req.InputPath)
	args = append(args, "-map", "0:v:0")
	if req.Probe.HasAudio {
		args = append(args, "-map", "0:a:0?")
	}
	args = append(args, "-c:v", codec.Video)
	if codec.Video == "libx264" {
		args = append(args, "-preset", "medium", "-crf", strconv.Itoa(crf), "-pix_fmt", "yuv420p")
	} else {
		args = append(args, "-crf", strconv.Itoa(crf), "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2")
	}
	filter := videoFilter(req.Scale)
	if filter == "" && codec.Video == "libx264" {
		filter = "scale=trunc(iw/2)*2:trunc(ih/2)*2"
	}
	if filter != "" {
		args = append(args, "-vf", filter)
	}
	if req.FPS > 0 {
		args = append(args, "-r", trimFloat(req.FPS))
	}
	if req.Probe.HasAudio {
		kbps := req.AudioKbps
		if kbps <= 0 {
			kbps = AudioDefaults(req.Kind, req.Output)
		}
		args = append(args, "-c:a", codec.Audio, "-b:a", fmt.Sprintf("%dk", kbps))
	}
	args = append(args, outputArgs(req.Output)...)
	args = append(args, req.OutputPath)
	return execute(ctx, ffmpegPath, args, req, 0, 100, "encode")
}

// runGIF creates a silent, looping GIF.
func runGIF(ctx context.Context, ffmpegPath string, req Request) error {
	filter := "fps=12"
	if scale := videoFilter(req.Scale); scale != "" {
		filter += "," + scale
	}
	args := baseArgs(req.InputPath)
	args = append(args, "-filter_complex",
		filter+",split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
		"-loop", "0", req.OutputPath)
	return execute(ctx, ffmpegPath, args, req, 0, 100, "encode")
}
