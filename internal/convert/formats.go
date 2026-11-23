// Package convert owns the VERT-like converter catalogue: format registry,
// ffprobe metadata, target-size planning and the ffmpeg command that performs a
// job. The browser has its own image/audio/video engines; this package is the
// server video path.
package convert

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// Kind is one of the three converter categories.
type Kind string

const (
	KindImage Kind = "image"
	KindAudio Kind = "audio"
	KindVideo Kind = "video"
)

// Format describes one output the UI offers.
type Format struct {
	Ext   string `json:"ext"`
	Kind  Kind   `json:"kind"`
	MIME  string `json:"mime"`
	Label string `json:"label"`
}

// Outputs is the server catalogue, in the order the UI shows it.
var Outputs = []Format{
	{Ext: "mp4", Kind: KindVideo, MIME: "video/mp4", Label: "MP4 (H.264 + AAC)"},
	{Ext: "webm", Kind: KindVideo, MIME: "video/webm", Label: "WebM (VP9 + Opus)"},
	{Ext: "mkv", Kind: KindVideo, MIME: "video/x-matroska", Label: "MKV (H.264 + AAC)"},
	{Ext: "mov", Kind: KindVideo, MIME: "video/quicktime", Label: "MOV (H.264 + AAC)"},
	{Ext: "gif", Kind: KindVideo, MIME: "image/gif", Label: "GIF (silent)"},
	{Ext: "mp3", Kind: KindAudio, MIME: "audio/mpeg", Label: "MP3"},
	{Ext: "m4a", Kind: KindAudio, MIME: "audio/mp4", Label: "M4A (AAC)"},
	{Ext: "aac", Kind: KindAudio, MIME: "audio/aac", Label: "AAC"},
	{Ext: "ogg", Kind: KindAudio, MIME: "audio/ogg", Label: "OGG (Vorbis)"},
	{Ext: "opus", Kind: KindAudio, MIME: "audio/ogg", Label: "Opus"},
	{Ext: "flac", Kind: KindAudio, MIME: "audio/flac", Label: "FLAC"},
	{Ext: "wav", Kind: KindAudio, MIME: "audio/wav", Label: "WAV"},
}

// inputKinds maps extensions the upload endpoint accepts to their category.
// Images are listed so the handler can answer "images convert locally" instead
// of pretending the format is unknown.
var inputKinds = map[string]Kind{
	// images (local only)
	"png": KindImage, "jpg": KindImage, "jpeg": KindImage, "webp": KindImage,
	"avif": KindImage, "gif": KindImage, "bmp": KindImage, "svg": KindImage,
	"ico": KindImage, "tif": KindImage, "tiff": KindImage,

	// audio
	"mp3": KindAudio, "wav": KindAudio, "flac": KindAudio, "ogg": KindAudio,
	"oga": KindAudio, "opus": KindAudio, "aac": KindAudio, "m4a": KindAudio,
	"m4b": KindAudio, "alac": KindAudio, "wma": KindAudio, "aiff": KindAudio,
	"aif": KindAudio, "aifc": KindAudio, "ac3": KindAudio, "mp2": KindAudio,
	"au": KindAudio, "voc": KindAudio, "tta": KindAudio,

	// video
	"mp4": KindVideo, "mkv": KindVideo, "mov": KindVideo, "webm": KindVideo,
	"avi": KindVideo, "m4v": KindVideo, "mts": KindVideo, "ts": KindVideo,
	"m2ts": KindVideo, "flv": KindVideo, "f4v": KindVideo, "wmv": KindVideo,
	"3gp": KindVideo, "3g2": KindVideo, "ogv": KindVideo, "mpg": KindVideo,
	"mpeg": KindVideo, "vob": KindVideo, "mxf": KindVideo, "gxf": KindVideo,
	"nut": KindVideo, "divx": KindVideo, "asf": KindVideo, "y4m": KindVideo,
	"ivf": KindVideo, "h264": KindVideo,
}

// ExtOf returns the lower-case extension of a file name without the dot.
func ExtOf(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	return strings.TrimPrefix(ext, ".")
}

// KindOf classifies an extension.
func KindOf(ext string) (Kind, bool) {
	kind, ok := inputKinds[strings.ToLower(strings.TrimPrefix(ext, "."))]
	return kind, ok
}

// InputExtensions returns the accepted upload extensions, sorted.
func InputExtensions() []string {
	out := make([]string, 0, len(inputKinds))
	for ext := range inputKinds {
		out = append(out, ext)
	}
	sort.Strings(out)
	return out
}

// FormatsFor returns the outputs of one category.
func FormatsFor(kind Kind) []Format {
	out := make([]Format, 0, len(Outputs))
	for _, format := range Outputs {
		if format.Kind == kind {
			out = append(out, format)
		}
	}
	return out
}

// OutputOf finds an output format by extension.
func OutputOf(ext string) (Format, bool) {
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))
	for _, format := range Outputs {
		if format.Ext == ext {
			return format, true
		}
	}
	return Format{}, false
}

// MIMEOf returns the content type of an output extension.
func MIMEOf(ext string) string {
	if format, ok := OutputOf(ext); ok {
		return format.MIME
	}
	return "application/octet-stream"
}

// TargetSizeSupported reports whether a target-size encode is meaningful. WAV
// and FLAC are lossless, and GIF/audio extraction are not video encodes.
func TargetSizeSupported(kind Kind, ext string) bool {
	switch kind {
	case KindAudio:
		return ext != "wav" && ext != "flac"
	case KindVideo:
		return ext == "mp4" || ext == "mkv" || ext == "mov" || ext == "webm"
	default:
		return false
	}
}

// codecs is the encoder pair of one output.
type codecs struct {
	Video string
	Audio string
	Muxer string
}

// codecsFor maps an output to its encoders. The server intentionally offers a
// curated set: every pair is widely playable and available in Alpine's ffmpeg.
func codecsFor(ext string) (codecs, error) {
	switch ext {
	case "mp4", "mov", "mkv":
		return codecs{Video: "libx264", Audio: "aac"}, nil
	case "webm":
		return codecs{Video: "libvpx-vp9", Audio: "libopus"}, nil
	case "gif":
		return codecs{Video: "gif"}, nil
	case "mp3":
		return codecs{Audio: "libmp3lame"}, nil
	case "m4a":
		return codecs{Audio: "aac"}, nil
	case "aac":
		return codecs{Audio: "aac", Muxer: "adts"}, nil
	case "ogg":
		return codecs{Audio: "libvorbis"}, nil
	case "opus":
		return codecs{Audio: "libopus"}, nil
	case "flac":
		return codecs{Audio: "flac"}, nil
	case "wav":
		return codecs{Audio: "pcm_s16le"}, nil
	default:
		return codecs{}, fmt.Errorf("convert: unsupported output %q", ext)
	}
}

// AudioDefaults returns the bitrate the UI starts with for an output.
func AudioDefaults(kind Kind, ext string) int {
	if kind == KindAudio {
		return 192
	}
	if ext == "webm" {
		return 96
	}
	return 128
}
