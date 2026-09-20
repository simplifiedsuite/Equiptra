package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"equiptra/internal/notify"
)

// Self-service "Forgot password" — see migration 0009's own comment for
// why this is a separate flow alongside AdminResetPassword/
// must_change_password, not a replacement. Ported from the same flow in
// the Ralto repo (backend/internal/handlers/crew_password_reset.go and
// staff_password_reset.go there) — see those for the fuller reasoning
// behind the generic response, the token hashing, and the row-lock on
// confirm, not repeated here.

const passwordResetTokenTTL = time.Hour

// randomToken — crypto/rand, not math/rand (this repo has no existing
// equivalent to Ralto's own randomToken helper).
func randomToken(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func hashResetToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// resetURLBase — FRONTEND_ORIGIN is comma-splittable (see main.go's own
// comment on why: the vercel.app URL and the equipment.simplifiedsuite.io
// custom domain can both be configured at once). The first one listed is
// what reset links point at.
func resetURLBase() string {
	origins := strings.Split(os.Getenv("FRONTEND_ORIGIN"), ",")
	origin := strings.TrimSpace(origins[0])
	if origin == "" {
		origin = "http://localhost:5173"
	}
	return origin
}

type forgotPasswordRequest struct {
	Email string `json:"email"`
}

// forgotPasswordResponseMessage is returned identically whether or not the
// email matches an account, so the endpoint can't be used to enumerate
// registered addresses.
const forgotPasswordResponseMessage = "If that email has an account, we've sent a link to reset your password."

func (a *API) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req forgotPasswordRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email != "" {
		var userID int64
		err := a.DB.QueryRow(r.Context(), `SELECT id FROM users WHERE lower(email) = $1`, email).Scan(&userID)
		if err == nil {
			if sendErr := a.issuePasswordResetToken(r.Context(), userID); sendErr != nil {
				// Logged server-side only — the response to the caller
				// stays generic regardless, so a transient failure here
				// can't be used to distinguish a real account from a fake
				// one either.
				log.Printf("password reset: failed to issue token for user %d: %v", userID, sendErr)
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("password reset: lookup failed: %v", err)
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": forgotPasswordResponseMessage})
}

func (a *API) issuePasswordResetToken(ctx context.Context, userID int64) error {
	var email, name string
	if err := a.DB.QueryRow(ctx, `SELECT email, name FROM users WHERE id = $1`, userID).Scan(&email, &name); err != nil {
		return err
	}
	if a.Notify == nil {
		return nil
	}

	token, err := randomToken(32)
	if err != nil {
		return err
	}
	hash := hashResetToken(token)
	expiresAt := time.Now().Add(passwordResetTokenTTL)
	if _, err := a.DB.Exec(ctx,
		`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, hash, expiresAt,
	); err != nil {
		return err
	}

	resetURL := resetURLBase() + "/reset-password?token=" + token
	subject, body := notify.RenderPasswordReset(resetURL)
	return a.Notify.SendEmail(email, name, subject, body)
}

type resetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

// ConfirmPasswordReset validates the token (unexpired, unused, row-locked
// against a double-spend race), applies the new password, and invalidates
// it — along with any other outstanding tokens for the same user.
func (a *API) ConfirmPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req resetPasswordRequest
	if err := readJSON(r, &req); err != nil || req.Token == "" {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "new password must be at least 8 characters")
		return
	}

	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "password reset failed")
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	var userID int64
	err = tx.QueryRow(ctx,
		`SELECT user_id FROM password_reset_tokens
		 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
		 FOR UPDATE`,
		hashResetToken(req.Token),
	).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusBadRequest, "this reset link is invalid or has expired")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "password reset failed")
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "password reset failed")
		return
	}
	if _, err := tx.Exec(ctx,
		`UPDATE users SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = $2`,
		string(newHash), userID,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "password reset failed")
		return
	}
	if _, err := tx.Exec(ctx,
		`UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
		userID,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "password reset failed")
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "password reset failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
