// Package version exposes the build metadata of the running FireConverter
// binary. CI injects Version and Commit through -ldflags; local builds keep the
// placeholders so /api/version always answers.
package version

import "runtime"

// Name is the product name used by the SPA, the docs and /api/version.
const Name = "FireConverter"

// Version is the semantic version of this build ("dev" for local builds).
var Version = "dev"

// Commit is the git SHA this binary was built from ("unknown" locally).
var Commit = "unknown"

// BuildDate is an optional RFC3339 timestamp filled by a future workflow.
var BuildDate = ""

// Info is the JSON payload returned by GET /api/version.
type Info struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	GoVersion string `json:"go_version"`
	BuildDate string `json:"build_date,omitempty"`
}

// Get returns the build metadata of the current binary.
func Get() Info {
	return Info{
		Name:      Name,
		Version:   Version,
		Commit:    Commit,
		GoVersion: runtime.Version(),
		BuildDate: BuildDate,
	}
}
