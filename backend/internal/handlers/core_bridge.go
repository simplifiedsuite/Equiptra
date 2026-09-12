package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"equiptra/internal/middleware"
	"equiptra/internal/models"
)

// BridgeCoreSession is Equiptra's half of Stage 2's SSO handoff
// (simplified_suite_screens_v0_3.md §5), ported from Ralto's own
// internal/handlers/core_bridge.go. It runs ahead of every route, including
// RequireAuth's own chain, and is a pure no-op unless BOTH hold: the request
// has no equiptra_session cookie yet, and it does carry a suite_session
// cookie (Core's shared .simplifiedsuite.io cookie). When both hold, it
// resolves the Core session to a local `users` row (lazy-creating one on
// first sight — step 4 of §5) and mints a completely ordinary
// equiptra_session for it, so RequireAuth — left entirely unmodified — sees
// exactly the request shape it already knows how to handle. A request
// carrying a valid equiptra_session, or carrying neither cookie, passes
// through untouched: the old login path is unaffected by this file existing
// at all.
//
// This is only reachable at all once Equiptra's frontend is served from a
// *.simplifiedsuite.io subdomain — the suite_session cookie is scoped to
// that domain by Core and is never sent to the current equiptra-smoky.vercel.app
// origin. See the domain-move note this was introduced alongside.
func (a *API) BridgeCoreSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := r.Cookie(middleware.CookieName); err == nil {
			next.ServeHTTP(w, r)
			return
		}
		suiteCookie, err := r.Cookie(middleware.CoreSessionCookieName)
		if err != nil || suiteCookie.Value == "" {
			next.ServeHTTP(w, r)
			return
		}

		person, err := middleware.FetchCorePerson(r.Context(), suiteCookie.Value)
		if err != nil || person == nil {
			// Core unreachable, or told us the token doesn't resolve — fall
			// through to the classic path, which 401s as it always has.
			next.ServeHTTP(w, r)
			return
		}

		role, hasEquipment := equipmentRoleFor(person)
		if !hasEquipment {
			next.ServeHTTP(w, r)
			return
		}

		userID, err := a.resolveOrCreateBridgedUser(r, person, role)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}

		token, err := middleware.IssueToken(userID, role, false)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		middleware.SetSessionCookie(w, token)
		// So this same request — not just the next one — sees a normal
		// session: RequireAuth reads this cookie right after.
		r.AddCookie(&http.Cookie{Name: middleware.CookieName, Value: token})
		next.ServeHTTP(w, r)
	})
}

// "equipment" is Core's capability name for what this codebase still calls
// Equiptra — see Simplified_Suite_Product_Structure_v1_0.pdf §5: Equiptra is
// kept only as the internal project name, not the product name Core's
// ProductAccess.product enum uses.
func equipmentRoleFor(person *middleware.CorePerson) (models.UserRole, bool) {
	for _, pa := range person.ProductAccess {
		if pa.Product != "equipment" {
			continue
		}
		switch models.UserRole(pa.Role) {
		case models.UserRoleAdmin, models.UserRoleStandard:
			return models.UserRole(pa.Role), true
		}
	}
	return "", false
}

// resolveOrCreateBridgedUser looks up a local users row "for that
// core_person_id" per simplified_suite_screens_v0_3.md §5 step 4 — a real
// link column (see migrations/0006_core_person_id.sql), not implicit email
// matching on every request. The email lookup below only ever fires once per
// person: it's how an existing local account predating Core (with
// core_person_id = null) gets linked to its Core identity the first time
// that person authenticates via the bridge. Every login after that hits the
// indexed core_person_id column directly. The synthetic password_hash on a
// freshly lazy-created row is a random value nobody is ever told — satisfies
// the NOT NULL column, but that account can only ever be reached through the
// Core bridge, never through Equiptra's own local /api/auth/login.
func (a *API) resolveOrCreateBridgedUser(r *http.Request, person *middleware.CorePerson, role models.UserRole) (int64, error) {
	var id int64

	err := a.DB.QueryRow(r.Context(), `SELECT id FROM users WHERE core_person_id = $1`, person.ID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}

	email := strings.ToLower(person.Email)

	err = a.DB.QueryRow(r.Context(),
		`UPDATE users SET core_person_id = $1 WHERE lower(email) = $2 RETURNING id`,
		person.ID, email,
	).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}

	unusable := make([]byte, 32)
	if _, err := rand.Read(unusable); err != nil {
		return 0, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(hex.EncodeToString(unusable)), bcrypt.DefaultCost)
	if err != nil {
		return 0, err
	}
	err = a.DB.QueryRow(r.Context(),
		`INSERT INTO users (name, email, role, password_hash, core_person_id)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id`,
		person.Name, email, role, string(hash), person.ID,
	).Scan(&id)
	return id, err
}
