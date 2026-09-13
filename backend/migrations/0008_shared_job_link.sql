-- Shared Core Job entity (see Core's own migrations/0008_jobs.sql): one
-- Monday order-number fetch, visible from every product. New, separate
-- link — not a rename of core_client_id/shared_contract_id (migrations/0007),
-- which resolve a Client/Contract respectively; this records which shared
-- Core Job (if any) a Project came from. Nullable: most projects are still
-- created by hand or predate this link entirely.

ALTER TABLE projects ADD COLUMN shared_job_id UUID;
