package convert

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// VideoInfo is the part of the first video stream the planner needs.
type VideoInfo struct {
	Codec  string  `json:"codec"`
	Width  int     `json:"width"`
	Height int     `json:"height"`
	FPS    float64 `json:"fps"`
}

// AudioInfo is the part of the first audio stream the planner needs.
type AudioInfo struct {
	Codec      string `json:"codec"`
	Channels   int    `json:"channels"`
	SampleRate int    `json:"sample_rate"`
	BitRate    int64  `json:"bit_rate"`
}

// Probe is the metadata of an uploaded file.
type Probe struct {
	FormatName string     `json:"format_name"`
	Duration   float64    `json:"duration_seconds"`
	Size       int64      `json:"size_bytes"`
	BitRate    int64      `json:"bit_rate"`
	Video      *VideoInfo `json:"video,omitempty"`
	Audio      *AudioInfo `json:"audio,omitempty"`
	HasVideo   bool       `json:"has_video"`
	HasAudio   bool       `json:"has_audio"`
}

// ffprobeDocument is the subset of `ffprobe -of json` we decode.
type ffprobeDocument struct {
	Streams []struct {
		CodecType    string `json:"codec_type"`
		CodecName    string `json:"codec_name"`
		Width        int    `json:"width"`
		Height       int    `json:"height"`
		AvgFrameRate string `json:"avg_frame_rate"`
		RFrameRate   string `json:"r_frame_rate"`
		Duration     string `json:"duration"`
		BitRate      string `json:"bit_rate"`
		Channels     int    `json:"channels"`
		SampleRate   string `json:"sample_rate"`
		Disposition  struct {
			AttachedPic int `json:"attached_pic"`
		} `json:"disposition"`
	} `json:"streams"`
	Format struct {
		FormatName string `json:"format_name"`
		Duration   string `json:"duration"`
		Size       string `json:"size"`
		BitRate    string `json:"bit_rate"`
	} `json:"format"`
}

// ProbeFile runs ffprobe and returns the metadata needed by the planner.
func ProbeFile(ctx context.Context, ffprobePath, path string) (*Probe, error) {
	probeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	command := exec.CommandContext(probeCtx, ffprobePath,
		"-v", "error",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		path,
	)
	output, err := command.Output()
	if err != nil {
		if probeCtx.Err() != nil {
			return nil, probeCtx.Err()
		}
		return nil, fmt.Errorf("%w: %v", ErrProbeFailed, err)
	}

	var document ffprobeDocument
	if err := json.Unmarshal(output, &document); err != nil {
		return nil, fmt.Errorf("%w: invalid ffprobe output", ErrProbeFailed)
	}

	probe := &Probe{
		FormatName: strings.TrimSpace(document.Format.FormatName),
		Duration:   parseFloat(document.Format.Duration),
		Size:       parseInt64(document.Format.Size),
		BitRate:    parseInt64(document.Format.BitRate),
	}
	if probe.Size <= 0 {
		probe.Size = fileSize(path)
	}

	for _, stream := range document.Streams {
		switch stream.CodecType {
		case "video":
			if stream.Disposition.AttachedPic != 0 {
				continue // album art is not a video track
			}
			if probe.Video == nil {
				probe.Video = &VideoInfo{
					Codec:  stream.CodecName,
					Width:  stream.Width,
					Height: stream.Height,
					FPS:    parseRational(stream.AvgFrameRate, stream.RFrameRate),
				}
				probe.HasVideo = true
			}
		case "audio":
			if probe.Audio == nil {
				probe.Audio = &AudioInfo{
					Codec:      stream.CodecName,
					Channels:   stream.Channels,
					SampleRate: int(parseInt64(stream.SampleRate)),
					BitRate:    parseInt64(stream.BitRate),
				}
				probe.HasAudio = true
			}
		}
		if probe.Duration <= 0 {
			probe.Duration = parseFloat(stream.Duration)
		}
	}

	return probe, nil
}

// ValidateFor checks that the input carries the stream an output needs.
func (p *Probe) ValidateFor(kind Kind, out string) error {
	switch kind {
	case KindAudio:
		if !p.HasAudio {
			return ErrNoAudioStream
		}
	case KindVideo:
		// GIF and MP3 extraction still start from a video file.
		if !p.HasVideo {
			return ErrNoVideoStream
		}
		if out == "mp3" && !p.HasAudio {
			return ErrNoAudioStream
		}
	default:
		return ErrUnsupportedOutput
	}
	return nil
}

func parseFloat(value string) float64 {
	value = strings.TrimSpace(value)
	if value == "" || value == "N/A" {
		return 0
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return 0
	}
	return parsed
}

func parseInt64(value string) int64 {
	value = strings.TrimSpace(value)
	if value == "" || value == "N/A" {
		return 0
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

func parseRational(values ...string) float64 {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || value == "0/0" || value == "N/A" {
			continue
		}
		parts := strings.Split(value, "/")
		if len(parts) != 2 {
			continue
		}
		numerator, firstErr := strconv.ParseFloat(parts[0], 64)
		denominator, secondErr := strconv.ParseFloat(parts[1], 64)
		if firstErr == nil && secondErr == nil && denominator > 0 {
			return numerator / denominator
		}
	}
	return 0
}
