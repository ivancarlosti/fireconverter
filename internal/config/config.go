// Package config loads every environment variable FireConverter needs.
//
// The process reads `.env` and `docker/.env` (best effort, without overriding
// the real environment), validates the values and returns one usable Config.
// Nothing else in the code base reads os.Getenv, which keeps configuration
// auditable from a single file.
package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config is the validated runtime configuration.
type Config struct {
	AppPort int
	// WorkDir holds one directory per job. It is erased on the TTL sweep.
	WorkDir string
	// LogLevel is "debug", "info", "warn" or "error".
	LogLevel string
	// TrustProxy makes the server read X-Forwarded-For for the per-IP job cap.
	// It must stay false unless a reverse proxy overwrites the header.
	TrustProxy bool

	MaxUploadBytes     int64
	MaxDurationSeconds int
	JobTTL             time.Duration
	MaxConcurrentJobs  int
	MaxJobsPerIP       int
	TargetSizeMaxBytes int64

	FFmpegPath  string
	FFprobePath string
}

// Load reads the environment, applies defaults and validates the result.
func Load() (*Config, error) {
	loadDotEnv(".env", "docker/.env")

	port, err := envInt("APP_PORT", 3000)
	if err != nil {
		return nil, err
	}
	maxUploadMB, err := envInt64("MAX_UPLOAD_MB", 2048)
	if err != nil {
		return nil, err
	}
	maxDuration, err := envInt("MAX_DURATION_SECONDS", 6*60*60)
	if err != nil {
		return nil, err
	}
	ttlMinutes, err := envInt("JOB_TTL_MINUTES", 60)
	if err != nil {
		return nil, err
	}
	concurrent, err := envInt("MAX_CONCURRENT_JOBS", 2)
	if err != nil {
		return nil, err
	}
	perIP, err := envInt("MAX_JOBS_PER_IP", 4)
	if err != nil {
		return nil, err
	}
	targetMaxMB, err := envInt64("TARGET_SIZE_MAX_MB", 4096)
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		AppPort:            port,
		WorkDir:            envString("WORK_DIR", filepath.Join(os.TempDir(), "fireconverter")),
		LogLevel:           strings.ToLower(envString("LOG_LEVEL", "info")),
		TrustProxy:         envBool("APP_TRUST_PROXY", false),
		MaxUploadBytes:     maxUploadMB * 1024 * 1024,
		MaxDurationSeconds: maxDuration,
		JobTTL:             time.Duration(ttlMinutes) * time.Minute,
		MaxConcurrentJobs:  concurrent,
		MaxJobsPerIP:       perIP,
		TargetSizeMaxBytes: targetMaxMB * 1024 * 1024,
		FFmpegPath:         envString("FFMPEG_PATH", "ffmpeg"),
		FFprobePath:        envString("FFPROBE_PATH", "ffprobe"),
	}

	switch {
	case cfg.AppPort < 1 || cfg.AppPort > 65535:
		return nil, fmt.Errorf("config: APP_PORT must be between 1 and 65535 (got %d)", cfg.AppPort)
	case cfg.WorkDir == "":
		return nil, fmt.Errorf("config: WORK_DIR must not be empty")
	case cfg.MaxUploadBytes < 1024*1024:
		return nil, fmt.Errorf("config: MAX_UPLOAD_MB must be at least 1")
	case cfg.MaxDurationSeconds < 1:
		return nil, fmt.Errorf("config: MAX_DURATION_SECONDS must be positive")
	case cfg.JobTTL < time.Minute:
		return nil, fmt.Errorf("config: JOB_TTL_MINUTES must be at least 1")
	case cfg.MaxConcurrentJobs < 1 || cfg.MaxConcurrentJobs > 64:
		return nil, fmt.Errorf("config: MAX_CONCURRENT_JOBS must be between 1 and 64")
	case cfg.MaxJobsPerIP < 1:
		return nil, fmt.Errorf("config: MAX_JOBS_PER_IP must be positive")
	case cfg.TargetSizeMaxBytes < 1024*1024:
		return nil, fmt.Errorf("config: TARGET_SIZE_MAX_MB must be at least 1")
	}

	switch cfg.LogLevel {
	case "debug", "info", "warn", "error":
	default:
		return nil, fmt.Errorf("config: LOG_LEVEL must be debug, info, warn or error (got %q)", cfg.LogLevel)
	}

	return cfg, nil
}

// Address is the listen address of the HTTP server.
func (c *Config) Address() string {
	return fmt.Sprintf(":%d", c.AppPort)
}

// Prepare creates the work directory.
func (c *Config) Prepare() error {
	if err := os.MkdirAll(c.WorkDir, 0o750); err != nil {
		return fmt.Errorf("config: creating WORK_DIR %s: %w", c.WorkDir, err)
	}
	return nil
}

// loadDotEnv applies KEY=VALUE lines from the given files. Existing environment
// variables always win, and a missing file is not an error.
func loadDotEnv(paths ...string) {
	for _, name := range paths {
		file, err := os.Open(name)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			key, value, found := strings.Cut(line, "=")
			if !found {
				continue
			}
			key = strings.TrimSpace(key)
			value = strings.TrimSpace(value)
			value = strings.Trim(value, `"'`)
			if key == "" {
				continue
			}
			if _, exists := os.LookupEnv(key); !exists {
				_ = os.Setenv(key, value)
			}
		}
		_ = file.Close()
	}
}

func envString(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("config: %s must be an integer (got %q)", key, raw)
	}
	return value, nil
}

func envInt64(key string, fallback int64) (int64, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("config: %s must be an integer (got %q)", key, raw)
	}
	return value, nil
}

// envBool accepts the spellings Docker and systemd users expect.
func envBool(key string, fallback bool) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch raw {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
