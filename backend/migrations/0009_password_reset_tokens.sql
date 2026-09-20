-- Self-service "Forgot password" — Equiptra had no email infrastructure at
-- all until now (see docs/equiptra-password-management-addendum.md, which
-- explicitly built the admin-triggered must_change_password mechanism as
-- the substitute). This adds a real self-service flow alongside it, not a
-- replacement — AdminResetPassword/must_change_password stay exactly as
-- they are. Mirrors Ralto's own password_reset_tokens table structure
-- (backend/migrations/0022_password_reset_tokens.sql in the Ralto repo):
-- token_hash (sha256), not the raw token, since a reset token is briefly
-- equivalent to full account takeover; no partial-unique constraint on
-- user_id, since a person can have more than one outstanding token and
-- using any one of them invalidates the rest (see the handler).
CREATE TABLE password_reset_tokens (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens (user_id);
