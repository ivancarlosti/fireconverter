// Package handlers wires the HTTP API, the security middleware and the
// embedded SPA into one handler tree.
package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/ivancarlosti/fireconverter/internal/convert"
	"github.com/ivancarlosti/fireconverter/internal/jobs"
)

// errorBody is the JSON shape of every error answer.
type errorBody struct {
	Code  string `json:"code"`
	Error string `json:"error"`
}

// writeJSON writes a JSON response with a no-store cache policy.
func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if payload != nil {
		_ = json.NewEncoder(w).Encode(payload)
	}
}

// writeError writes the stable error envelope.
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{Code: code, Error: message})
}

// fail maps any error to a status, a stable code and a safe message.
func fail(w http.ResponseWriter, err error) {
	status, code, message := describe(err)
	if status >= 500 {
		slog.Error("request failed", "error", err, "code", code)
		if code == "internal" {
			message = "unexpected error, check the server logs"
		}
	}
	writeError(w, status, code, message)
}

func describe(err error) (int, string, string) {
	var maxBytes *http.MaxBytesError
	var tooLarge *jobs.TooLargeError
	var tooLong *jobs.TooLongError
	var targetTooLarge *jobs.TargetTooLargeError
	var tooSmall *convert.TargetTooSmallError
	var encoder *convert.EncoderError
	var validation *validationError

	switch {
	case err == nil:
		return http.StatusOK, "", ""
	case errors.As(err, &validation):
		return http.StatusBadRequest, "validation", validation.Error()
	case errors.As(err, &maxBytes), errors.As(err, &tooLarge):
		return http.StatusRequestEntityTooLarge, "too_large", "the uploaded file exceeds the size limit"
	case errors.As(err, &tooLong):
		return http.StatusUnprocessableEntity, "too_long", err.Error()
	case errors.As(err, &targetTooLarge):
		return http.StatusUnprocessableEntity, "target_too_large", err.Error()
	case errors.As(err, &tooSmall):
		return http.StatusUnprocessableEntity, "target_too_small", err.Error()
	case errors.As(err, &encoder):
		return http.StatusInternalServerError, "encode_failed", encoder.Error()
	case errors.Is(err, jobs.ErrNotFound):
		return http.StatusNotFound, "not_found", "the job does not exist or expired"
	case errors.Is(err, jobs.ErrInvalidState):
		return http.StatusConflict, "invalid_state", "the job is not in the expected state"
	case errors.Is(err, jobs.ErrBusy):
		return http.StatusTooManyRequests, "busy", "the server is busy, try again in a moment"
	case errors.Is(err, jobs.ErrEmptyFile):
		return http.StatusBadRequest, "empty_file", "the uploaded file is empty"
	case errors.Is(err, jobs.ErrImageLocal):
		return http.StatusBadRequest, "image_local", "images are converted in the browser and never uploaded"
	case errors.Is(err, jobs.ErrNotReady):
		return http.StatusServiceUnavailable, "not_ready", "the conversion service is starting"
	case errors.Is(err, convert.ErrFFmpegMissing):
		return http.StatusServiceUnavailable, "ffmpeg_missing", "server conversion is not available on this instance"
	case errors.Is(err, convert.ErrUnsupportedOutput):
		return http.StatusUnsupportedMediaType, "unsupported", "this format is not supported"
	case errors.Is(err, convert.ErrTargetUnsupported):
		return http.StatusUnprocessableEntity, "target_unsupported", "this output cannot hit a target size"
	case errors.Is(err, convert.ErrNoVideoStream):
		return http.StatusUnprocessableEntity, "no_video", "the file has no video track"
	case errors.Is(err, convert.ErrNoAudioStream):
		return http.StatusUnprocessableEntity, "no_audio", "the file has no audio track"
	case errors.Is(err, convert.ErrDurationUnknown):
		return http.StatusUnprocessableEntity, "duration_unknown", "the duration of the file could not be read"
	case errors.Is(err, convert.ErrProbeFailed):
		return http.StatusUnprocessableEntity, "probe_failed", "the file could not be inspected"
	case errors.Is(err, convert.ErrEmptyOutput), errors.Is(err, convert.ErrTargetMissed):
		return http.StatusInternalServerError, "encode_failed", err.Error()
	case errors.Is(err, context.DeadlineExceeded):
		return http.StatusGatewayTimeout, "timeout", "the conversion took too long"
	case errors.Is(err, context.Canceled):
		return http.StatusRequestTimeout, "canceled", "the request was cancelled"
	default:
		return http.StatusInternalServerError, "internal", "unexpected error, check the server logs"
	}
}
