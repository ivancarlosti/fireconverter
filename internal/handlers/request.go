package handlers

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"
)

// decodeJSON reads a small JSON body. Uploads use multipart instead.
func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "validation", "the request body is not valid JSON: "+err.Error())
		return false
	}
	return true
}

// clientIP returns the address the per-IP cap counts. X-Forwarded-For is only
// trusted when APP_TRUST_PROXY is set, so a direct client cannot spoof it.
func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			first, _, _ := strings.Cut(forwarded, ",")
			if ip := net.ParseIP(strings.TrimSpace(first)); ip != nil {
				return ip.String()
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
