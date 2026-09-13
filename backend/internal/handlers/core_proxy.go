package handlers

import (
	"bytes"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"equiptra/internal/middleware"
)

var coreProxyClient = &http.Client{Timeout: 10 * time.Second}

// proxyToCore forwards the caller's own suite_session cookie to Core and
// relays Core's response (status + body) back verbatim. Same pattern as
// Crewing's own internal/handlers/core_proxy.go (Job Fetch-from-Monday,
// Stage A) — reused here for Stage B's Client match/Contract picker rather
// than inventing a second approach for the same problem.
func (a *API) proxyToCore(w http.ResponseWriter, r *http.Request, path string) {
	base := middleware.CoreAPIURL()
	if base == "" {
		writeError(w, http.StatusServiceUnavailable, "Simplified Suite Core isn't configured (CORE_API_URL not set)")
		return
	}
	suiteCookie, err := r.Cookie(middleware.CoreSessionCookieName)
	if err != nil || suiteCookie.Value == "" {
		writeError(w, http.StatusServiceUnavailable, "not signed in to Simplified Suite")
		return
	}

	var bodyReader io.Reader
	if r.Method != http.MethodGet {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, base+path, bodyReader)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not reach Simplified Suite Core")
		return
	}
	req.AddCookie(&http.Cookie{Name: middleware.CoreSessionCookieName, Value: suiteCookie.Value})
	if r.Method != http.MethodGet {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := coreProxyClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "could not reach Simplified Suite Core")
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "could not reach Simplified Suite Core")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBody)
}

// ListCoreClients backs the Project "match this client against Core" step —
// live per docs/simplified_suite_core_v0_6.md §5a's picker rule, not read
// from any local mirror (Equipment has none — see migrations/0007).
func (a *API) ListCoreClients(w http.ResponseWriter, r *http.Request) {
	a.proxyToCore(w, r, "/api/clients")
}

// CreateCoreClient proxies a "no match — create a new Client" request
// straight to Core's own POST /api/clients. Core enforces who's allowed to
// do this (organisation owner only) — Equipment doesn't duplicate that
// check, it just relays whatever Core decides, including a 403.
func (a *API) CreateCoreClient(w http.ResponseWriter, r *http.Request) {
	a.proxyToCore(w, r, "/api/clients")
}

// ListCoreContracts backs the Project "Link to a Contract?" picker, scoped
// to the resolved Client.
func (a *API) ListCoreContracts(w http.ResponseWriter, r *http.Request) {
	clientID := strings.TrimSpace(r.URL.Query().Get("client_id"))
	if clientID == "" {
		writeError(w, http.StatusBadRequest, "client_id is required")
		return
	}
	a.proxyToCore(w, r, "/api/contracts?client_id="+url.QueryEscape(clientID))
}
