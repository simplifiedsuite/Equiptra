-- Backfill — every table in this project shipped without
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, so Supabase exposed all ten
-- (including `users` and `password_reset_tokens`) through its public REST
-- API to anyone with the project URL, bypassing the Go backend's own auth
-- checks entirely. Flagged by Supabase's security advisor. RLS was already
-- enabled directly against the live database as an out-of-band fix — this
-- migration exists purely so migration history matches reality instead of
-- silently understating it, not because anything is still exposed. No
-- policies are added: the Go backend connects as the table owner, which
-- bypasses RLS regardless of policies, so RLS-with-zero-policies is a
-- correct default-deny for the anon/authenticated Supabase roles this app
-- never uses — same convention Crewing (this project's sibling app)
-- already established. Going forward, every migration that CREATE TABLEs
-- should ALTER TABLE ... ENABLE ROW LEVEL SECURITY in the same file — see
-- CLAUDE.md. ENABLE ROW LEVEL SECURITY is idempotent (a no-op re-running
-- it on a table that already has it on), so this is safe to apply on top
-- of the already-fixed live database.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_defaults ENABLE ROW LEVEL SECURITY;
