package convert

import "os"

// fileSize returns the size of a path, or 0 when it cannot be read.
func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}
