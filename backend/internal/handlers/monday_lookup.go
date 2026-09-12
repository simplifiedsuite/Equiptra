package handlers

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"equiptra/internal/middleware"
)

var mondayProxyClient = &http.Client{Timeout: 10 * time.Second}

// MondayProjectLookup backs the "Fetch from Monday" button on new-project
// creation. This used to call Monday.com's API directly with its own
// MONDAY_API_TOKEN — Core now owns that credential (see
// Simplified_Suite_Product_Structure_v1_0.pdf's decision that Core owns
// third-party connections; other products call Core instead of the
// provider directly), so this just proxies to Core's own
// /api/integrations/monday/project-lookup, forwarding the caller's
// suite_session cookie so Core resolves the same organisation the request
// is already authenticated as. Response shape and status codes are
// unchanged from before, so the frontend needed no changes at all.
func (a *API) MondayProjectLookup(w http.ResponseWriter, r *http.Request) {
	orderNumber := strings.TrimSpace(r.URL.Query().Get("order_number"))
	if orderNumber == "" {
		writeError(w, http.StatusBadRequest, "order_number is required")
		return
	}

	base := middleware.CoreAPIURL()
	if base == "" {
		writeError(w, http.StatusServiceUnavailable, "Monday lookup isn't configured (CORE_API_URL not set) — enter project details manually")
		return
	}

	suiteCookie, err := r.Cookie(middleware.CoreSessionCookieName)
	if err != nil || suiteCookie.Value == "" {
		writeError(w, http.StatusServiceUnavailable, "not signed in to Simplified Suite — enter project details manually")
		return
	}

	target := base + "/api/integrations/monday/project-lookup?order_number=" + url.QueryEscape(orderNumber)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not reach Monday — enter project details manually")
		return
	}
	req.AddCookie(&http.Cookie{Name: middleware.CoreSessionCookieName, Value: suiteCookie.Value})

	resp, err := mondayProxyClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "could not reach Monday — enter project details manually")
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "could not reach Monday — enter project details manually")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}
