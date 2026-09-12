-- Simplified Suite Core SSO bridge (mirrors Ralto's own
-- migrations/0008_core_person_id.sql): Equiptra looks up its local `users`
-- row "for that core_person_id" — a real link column, not implicit email
-- matching on every request. Bare UUID, no FK: Core lives in a separate
-- database. Nullable because every existing users row predates Core and has
-- no Core identity yet — BridgeCoreSession backfills it on each row's first
-- successful Core-authenticated login, matching by email for that one-time
-- link and by this column thereafter.

ALTER TABLE users ADD COLUMN core_person_id UUID;
CREATE UNIQUE INDEX idx_users_core_person_id ON users(core_person_id) WHERE core_person_id IS NOT NULL;
