package convert

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// execute runs ffmpeg with `-progress pipe:1` and maps out_time to a percentage
// inside the [from, to] window of the job.
func execute(ctx context.Context, ffmpegPath string, args []string, req Request, from, to float64, stage string) error {
	args = append([]string{"-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats"}, args...)
	command := exec.CommandContext(ctx, ffmpegPath, args...)
	stderr := &tailBuffer{limit: 16 * 1024}
	command.Stderr = stderr
	stdout, err := command.StdoutPipe()
	if err != nil {
		return err
	}
	if err := command.Start(); err != nil {
		return &EncoderError{Tail: sanitizeTail(err.Error(), req)}
	}

	duration := 0.0
	if req.Plan != nil {
		duration = req.Plan.DurationSeconds
	} else if req.Probe != nil {
		duration = req.Probe.Duration
	}

	last := -1.0
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		seconds, ok := progressSeconds(scanner.Text())
		if !ok || duration <= 0 {
			continue
		}
		fraction := seconds / duration
		if fraction > 1 {
			fraction = 1
		}
		percent := from + (to-from)*fraction
		if percent > 99.5 {
			percent = 99.5
		}
		if percent >= last+0.5 && req.OnProgress != nil {
			last = percent
			req.OnProgress(percent, stage)
		}
	}

	waitErr := command.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if waitErr != nil {
		return &EncoderError{Tail: sanitizeTail(stderr.String(), req)}
	}
	return nil
}

// progressSeconds parses the `out_time_*` keys of ffmpeg's progress stream.
// out_time_ms is microseconds (an ffmpeg naming quirk), so it is divided by 1e6.
func progressSeconds(line string) (float64, bool) {
	value, found := strings.CutPrefix(line, "out_time_us=")
	if !found {
		value, found = strings.CutPrefix(line, "out_time_ms=")
	}
	if found {
		microseconds, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
		if err != nil || microseconds < 0 {
			return 0, false
		}
		return float64(microseconds) / 1e6, true
	}
	if value, found := strings.CutPrefix(line, "out_time="); found {
		parts := strings.Split(strings.TrimSpace(value), ":")
		if len(parts) != 3 {
			return 0, false
		}
		hours, err1 := strconv.ParseFloat(parts[0], 64)
		minutes, err2 := strconv.ParseFloat(parts[1], 64)
		seconds, err3 := strconv.ParseFloat(parts[2], 64)
		if err1 != nil || err2 != nil || err3 != nil {
			return 0, false
		}
		return hours*3600 + minutes*60 + seconds, true
	}
	return 0, false
}

// tailBuffer keeps the last `limit` bytes written to it.
type tailBuffer struct {
	limit int
	data  []byte
}

func (b *tailBuffer) Write(p []byte) (int, error) {
	b.data = append(b.data, p...)
	if len(b.data) > b.limit {
		b.data = b.data[len(b.data)-b.limit:]
	}
	return len(p), nil
}

func (b *tailBuffer) String() string {
	return string(b.data)
}

// sanitizeTail turns ffmpeg's stderr into a short, path-free technical detail.
func sanitizeTail(raw string, req Request) string {
	raw = strings.ReplaceAll(raw, req.InputPath, "input")
	raw = strings.ReplaceAll(raw, req.OutputPath, "output")
	raw = strings.ReplaceAll(raw, filepath.Dir(req.OutputPath), "work")
	lines := strings.Split(strings.TrimSpace(raw), "\n")
	if len(lines) > 4 {
		lines = lines[len(lines)-4:]
	}
	tail := strings.TrimSpace(strings.Join(lines, " | "))
	if len(tail) > 600 {
		tail = tail[len(tail)-600:]
	}
	return tail
}

// baseArgs is the common ffmpeg prefix of every command.
func baseArgs(input string) []string {
	return []string{"-y", "-i", input}
}

// outputArgs adds container-specific flags.
func outputArgs(out string) []string {
	switch out {
	case "mp4", "mov", "m4a":
		return []string{"-movflags", "+faststart"}
	default:
		return nil
	}
}

// videoFilter builds the scale expression from a WxH request. The filter keeps
// the aspect ratio and makes both dimensions even for H.264.
func videoFilter(scale string) string {
	scale = strings.TrimSpace(strings.ToLower(scale))
	if scale == "" {
		return ""
	}
	width, height, found := strings.Cut(scale, "x")
	if !found {
		return ""
	}
	w, err1 := strconv.Atoi(width)
	h, err2 := strconv.Atoi(height)
	if err1 != nil || err2 != nil || w < 16 || h < 16 || w > 16384 || h > 16384 {
		return ""
	}
	return fmt.Sprintf("scale=w=%d:h=%d:force_original_aspect_ratio=decrease:force_divisible_by=2", w, h)
}

// trimFloat renders a float without a trailing .0.
func trimFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}
