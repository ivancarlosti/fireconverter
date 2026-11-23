// Package web embeds the compiled Vue SPA into the Go binary.
//
// `web/dist` is produced by `npm run build` and embedded at compile time, so the
// released image contains one static binary and needs no Node at runtime.
//
// `web/dist/.gitkeep` is committed on purpose: `//go:embed` refuses to compile
// when the pattern matches nothing, which would break a fresh clone before the
// first frontend build.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embedded embed.FS

// Dist returns the SPA rooted at `dist`.
func Dist() fs.FS {
	sub, err := fs.Sub(embedded, "dist")
	if err != nil {
		panic("web: the embedded dist directory is missing: " + err.Error())
	}
	return sub
}
