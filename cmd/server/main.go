// Command server is the FireConverter binary: HTTP API, job manager and the
// embedded Vue SPA in one process.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ivancarlosti/fireconverter/internal/config"
	"github.com/ivancarlosti/fireconverter/internal/handlers"
	"github.com/ivancarlosti/fireconverter/internal/jobs"
	"github.com/ivancarlosti/fireconverter/internal/version"
	"github.com/ivancarlosti/fireconverter/web"
)

const (
	readHeaderTimeout = 15 * time.Second
	idleTimeout       = 60 * time.Second
	shutdownTimeout   = 20 * time.Second
)

func main() {
	if err := run(); err != nil {
		slog.Error("fireconverter stopped with an error", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: logLevel(cfg.LogLevel),
	})))
	if err := cfg.Prepare(); err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	manager := jobs.New(cfg)
	if !manager.Available() {
		slog.Warn("server-side conversion is unavailable: ffmpeg/ffprobe not found; the SPA keeps local conversion",
			"ffmpeg", cfg.FFmpegPath, "ffprobe", cfg.FFprobePath)
	} else {
		slog.Info("ffmpeg detected", "version", manager.FFmpegVersion())
	}
	manager.Start(ctx)
	defer manager.Stop()

	api := handlers.New(cfg, manager, web.Dist())
	server := &http.Server{
		Addr:              cfg.Address(),
		Handler:           api.Handler(),
		ReadHeaderTimeout: readHeaderTimeout,
		IdleTimeout:       idleTimeout,
		MaxHeaderBytes:    1 << 20,
	}

	failed := make(chan error, 1)
	go func() {
		slog.Info("fireconverter is listening",
			"address", cfg.Address(),
			"version", version.Version,
			"commit", version.Commit,
			"work_dir", cfg.WorkDir,
			"server_conversion", manager.Available())
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			failed <- err
		}
	}()

	select {
	case err := <-failed:
		return err
	case <-ctx.Done():
		slog.Info("shutdown requested, draining")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Warn("the http server did not drain in time", "error", err)
	}
	manager.Stop()
	slog.Info("bye")
	return nil
}

func logLevel(value string) slog.Level {
	switch value {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
