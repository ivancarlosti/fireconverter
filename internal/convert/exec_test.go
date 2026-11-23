package convert

import "testing"

func TestProgressSeconds(t *testing.T) {
	cases := map[string]float64{
		"out_time_us=1500000":  1.5,
		"out_time_ms=2500000":  2.5,
		"out_time=00:01:02.50": 62.5,
	}
	for line, want := range cases {
		got, ok := progressSeconds(line)
		if !ok || got != want {
			t.Fatalf("progressSeconds(%q) = %v, %v; want %v", line, got, ok, want)
		}
	}
	if _, ok := progressSeconds("progress=continue"); ok {
		t.Fatal("progress=continue must not parse as a time")
	}
}
