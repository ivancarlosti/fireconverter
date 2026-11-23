package convert

import "testing"

func TestKindOf(t *testing.T) {
	cases := map[string]Kind{
		"photo.JPEG": KindImage,
		"clip.MP4":   KindVideo,
		"track.flac": KindAudio,
	}
	for name, want := range cases {
		if got, ok := KindOf(ExtOf(name)); !ok || got != want {
			t.Fatalf("KindOf(%q) = %q, %v; want %q", name, got, ok, want)
		}
	}
	if _, ok := KindOf("exe"); ok {
		t.Fatal("exe must not be classified")
	}
}

func TestTargetSizeSupport(t *testing.T) {
	if !TargetSizeSupported(KindVideo, "mp4") {
		t.Fatal("mp4 must support target size")
	}
	if TargetSizeSupported(KindVideo, "gif") {
		t.Fatal("gif must not support target size")
	}
	if TargetSizeSupported(KindAudio, "wav") || TargetSizeSupported(KindAudio, "flac") {
		t.Fatal("lossless audio must not support target size")
	}
	if !TargetSizeSupported(KindAudio, "mp3") {
		t.Fatal("mp3 must support target size")
	}
}

func TestOutputsAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, format := range Outputs {
		if seen[format.Ext] {
			t.Fatalf("duplicate output %q", format.Ext)
		}
		seen[format.Ext] = true
		if MIMEOf(format.Ext) == "" || MIMEOf(format.Ext) == "application/octet-stream" {
			t.Fatalf("output %q has no MIME type", format.Ext)
		}
	}
}
