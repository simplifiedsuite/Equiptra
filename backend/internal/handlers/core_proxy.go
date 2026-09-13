package handlers

import (
	"bytes"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

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

// GetCoreJobByOrderNumber is the "check Core first" step of the shared Job
// entity (see Core's own migrations/0008_jobs.sql): an order number is a
// real, exact, unique identifier — unlike Client name, so this is a
// straight lookup, no matching/confirmation involved. 404 means no
// product has fetched this order number before; fall through to the
// existing Monday-fetch + Client match/Contract-picker flow, unchanged.
func (a *API) GetCoreJobByOrderNumber(w http.ResponseWriter, r *http.Request) {
	orderNumber := strings.TrimSpace(r.URL.Query().Get("order_number"))
	if orderNumber == "" {
		writeError(w, http.StatusBadRequest, "order_number is required")
		return
	}
	a.proxyToCore(w, r, "/api/jobs?order_number="+url.QueryEscape(orderNumber))
}

// CreateCoreJob persists a shared Job once this product has already run
// the existing Client match/confirm (and optional Contract picker) flow —
// called only on the "Core doesn't have this order number yet" path,
// right before creating the local Project, so the next fetch (from either
// product) finds it immediately.
func (a *API) CreateCoreJob(w http.ResponseWriter, r *http.Request) {
	a.proxyToCore(w, r, "/api/jobs")
}

// RefreshCoreJob is the explicit "re-check Monday" action on an already-
// found shared Job — the everyday fetch path never calls Monday at all
// once Core already has the order number; only this does.
func (a *API) RefreshCoreJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	a.proxyToCore(w, r, "/api/jobs/"+url.PathEscape(id)+"/refresh")
}
