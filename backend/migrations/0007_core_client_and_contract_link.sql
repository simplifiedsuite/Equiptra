-- Job Fetch-from-Monday, Stage B (Equipment) — bringing Equipment's Project
-- up to the same standard as Crewing's Job (see Crewing's own
-- migrations/0009_core_client_and_contract_link.sql and
-- docs/simplified_suite_core_v0_6.md §5/§8a).
--
-- Different shape than Crewing's, deliberately: Equipment has no local
-- `clients` table at all — `projects.client` has only ever been a bare,
-- unbacked free-text label (confirmed: no clients table anywhere in this
-- repo's migrations, no other entity references a client_id). Crewing
-- needed a local clients table row to satisfy jobs.client_id's NOT NULL
-- FK constraint, so Stage A mirrored Core's Client into a local row via
-- core_client_id + a find-or-create endpoint. Equipment has no such
-- constraint to satisfy - client is just a display string - so the link
-- goes straight on projects itself, no local mirror table needed:
-- core_client_id records which Core Client the (still free-text) `client`
-- column's name came from, once matched/confirmed/created via the same
-- flow Crewing uses. Nullable: existing/manually-typed projects have no
-- Core identity and none is required.
--
-- shared_contract_id/shared_contract_name mirror Crewing's naming and
-- "cached label, not live-refreshed" behaviour exactly (§5b) - a direct,
-- optional link to Core's Contract, unrelated to anything else in this
-- schema.

ALTER TABLE projects ADD COLUMN core_client_id UUID;
ALTER TABLE projects ADD COLUMN shared_contract_id UUID;
ALTER TABLE projects ADD COLUMN shared_contract_name TEXT;
