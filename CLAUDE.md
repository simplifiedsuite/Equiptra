# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Equiptra is LDMtv's internal broadcast-equipment asset/project/booking tracker, replacing CurrentRMS. Full spec: [`equiptra-build-brief.md`](equiptra-build-brief.md) — the two-phase `booking_requests` → `booking_allocations` model in §3 is the core of the data model. [`README.md`](README.md) has deployment/env-var details not repeated here.

## Stack

- Backend: Go (`backend/`), chi router, pgx/v5, Postgres — deploys to Render
- Frontend: React 19 + TypeScript + Tailwind v4 (`frontend/`), Vite, react-router-dom v7 — deploys to Vercel
- Database: Supabase-hosted Postgres
- File storage: Supabase Storage's native REST API (bearer token, not the S3-compatible endpoint — that failed with SignatureDoesNotMatch), via `internal/storage/supabase.go` — feature is fully disabled if `SUPABASE_PROJECT_REF`/`SUPABASE_SERVICE_ROLE_KEY` are unset
- Auth: email/password + bcrypt, JWT session cookie (`equiptra_session`), `admin`/`standard` roles

## Commands

```bash
# Backend — from backend/
go build ./...                                    # compile check (no test suite exists yet)
DATABASE_URL="postgres://localhost:5432/equiptra?sslmode=disable" \
JWT_SECRET="change-me" FRONTEND_ORIGIN="http://localhost:5173" go run ./cmd/api

# Frontend — from frontend/
npm run dev      # vite dev server on :5173, proxies /api to localhost:8080 (see vite.config.ts)
npm run build    # tsc -b && vite build — treat as the frontend's compile check
npm run lint      # oxlint
```

Local Postgres setup, CSV migration tooling (`cmd/migrate`, `cmd/migrate-photos`), and the full env var table are in [`README.md`](README.md#local-setup) — don't duplicate here, read it before setting up a local environment.

## Architecture

### Two-phase booking model (the core abstraction)

`booking_requests` (a product-level ask: "need 3 of product X, date range Y") → `booking_allocations` (a specific asset committed to that request, with its own checkout/check-in lifecycle). A request can be partially allocated; each allocation tracks `allocated → checked_out → returned` independently, with `checked_out_by`/`checked_in_by` user references and optional damage flagging.

- **Bulk vs. serialized assets**: `booking_allocations` has no quantity column. Allocating 3 units of a bulk product creates 3 rows all pointing at the same bulk `asset_id`. Conflict checking branches on this: serialized assets use `findAllocationConflicts` (same asset, overlapping dates = conflict); bulk assets use `bulkOverAllocationCount` instead (count of concurrent overlapping allocations vs. the asset's held `quantity`) since multiple allocations sharing one bulk `asset_id` is normal. See `internal/handlers/booking_allocations.go`.
- **`booking_requests.status` is derived, not set directly.** `recomputeBookingRequestStatus` (in `booking_requests.go`) recalculates it from the request's allocations after every mutation — except `cancelled`, which is a deliberate action via `POST /booking-requests/{id}/cancel` and is left untouched by the recompute.
- **Shortage flag**: a request is short if its own quantity plus every other *live* (`reserved`/`partially_allocated`/`out`) request for the same product with an overlapping date range exceeds the product's total *active* asset stock. See `computeShortage`.
- **Availability on the Products list** (`ListProducts`): `total_units` only counts `assets.status = 'active'`; `available_units` subtracts active (`allocated`/`checked_out`) allocations from that. `written_off`/`sold`/`missing` assets are excluded from both automatically — don't re-derive this by hand elsewhere.
- **Project status guards booking creation**: `CreateBookingRequest` and `CreateAllocation` both reject with a 400 if the parent project's status is `cancelled` or `completed`. This is a live status check (not a history check), so moving a project back to `in_progress` immediately re-enables booking creation.
- **Project delete vs. cancel**: `DeleteProject` checks for real `booking_allocations` history (joined through the project's `booking_requests`), not mere `booking_request` row existence — a project whose requests were all cancelled with zero allocations is safe to delete, and its (empty) `booking_requests` are cascade-deleted in the same transaction. `CancelProject` (sets `status = 'cancelled'`) is the always-available fast path; `DeleteProject` is for cleaning up test/duplicate projects and is blocked once any real allocation (checkout/check-in/damage) history exists. The same pattern is mirrored for users: `DeleteUser` is blocked if the user appears as `checked_out_by`/`checked_in_by` on any allocation — deactivate (`active` flag) instead.

### Backend request handling conventions

- Every handler is a method on `*API` (`internal/handlers/helpers.go`), holding `DB *pgxpool.Pool` and `Supabase *storage.SupabaseClient`.
- `readJSON` uses `json.NewDecoder(...).DisallowUnknownFields()` — a strict decode. Spreading a full GET response into a PUT/PATCH body (a natural React pattern) will 400 if that object carries any field the write struct doesn't declare (e.g. read-only fields like `id`/`created_at`). Write structs list only what's actually writable; construct payloads explicitly on the frontend rather than object-spreading a fetched entity.
- Auth is `internal/middleware`: `RequireAuth` parses the `equiptra_session` JWT cookie (HS256, `JWT_SECRET` env, insecure dev fallback if unset) into request context; `RequireAdmin` chains after it and checks `role == admin`. Route groups in `cmd/api/main.go` show the actual admin-gating: products/assets have create/edit open to any authenticated user (delete + photo upload admin-only) as a **deliberate, temporary decision** — see README "Still open" section before changing this. `/users` is entirely admin-gated (account/login management is more sensitive than inventory).
- Deactivating a user only blocks *future* logins (`Login` checks `users.active`) — an already-issued JWT stays valid for its normal life; there's no per-request DB check killing live sessions on deactivation.
- Postgres enum columns need `::text` casts in dynamic `WHERE` clauses (e.g. `status::text = $1`) — type coercion happens before an empty-string short-circuit `OR` can save you, otherwise `WHERE status = ''` errors instead of matching nothing.
- Migrations are plain numbered SQL files in `backend/migrations/`, applied by hand (`psql $DATABASE_URL -f backend/migrations/000N_*.sql`) — no migration runner. The Supabase (production) database requires the connection string to apply against; that's not available in an agent session, so a new migration needs a human to run it before the corresponding feature works in production.

### Frontend conventions

- `context/AuthContext.tsx` exposes `useAuth()` → `{ user, loading, login, logout }`; `user.role` drives admin-only UI (nav items, routes) — see `App.tsx`'s `RequireAdmin` wrapper and `components/Layout.tsx`'s conditional nav item.
- `lib/api.ts` is a thin fetch wrapper (`api.get/post/put/patch/delete`) that always sends `credentials: 'include'` and throws `ApiError` (with `.status`/`.message`) on non-2xx — catch this type specifically to surface backend error messages in the UI rather than a generic fallback.
- Create/edit forms follow one shared-component-with-optional-entity-prop pattern throughout (`ProductFormModal`, `ProjectFormModal`, etc.): presence of the entity prop toggles edit vs. create mode and which HTTP verb/status defaults apply. Follow this pattern for new entity forms rather than splitting New/Edit into separate components.
- `components/CategoryChips.tsx` is the single source of category-filter UI, reused across the Products browse page and the booking-request product search — don't reinstate a local/inline copy.
- Heavy dependencies used occasionally (e.g. `@zxing/library` for barcode scanning) should be dynamically `import()`ed at the point of use, not imported at module top level — it roughly tripled the main bundle size when done statically during initial build.
- Tables must wrap in a scrollable `<div className="overflow-x-auto">` around the `<table>`, not rely on `overflow-hidden` on the outer card — the latter clips content instead of allowing horizontal scroll on mobile widths, which was a real bug found across every table-using page.
- Destructive-action buttons that get disabled (delete guards, self-action guards) should carry both a `title` tooltip (desktop hover) and an always-visible inline text explanation — `title`-only tooltips don't work on touch devices.

## Row-level security — every table, deny-all, no exceptions

Every table in Supabase has RLS enabled with zero policies. That's deliberate, not a placeholder waiting for policies: nothing in Equiptra talks to Postgres through the Supabase client libraries or the anon key (only `internal/storage/supabase.go` uses a service-role key, for Storage's REST API, not Postgres), so the `anon`/`authenticated` roles never need table access, and RLS-with-no-policies denies them outright. The Go backend connects directly to Postgres as the table owner, and owners bypass RLS regardless of policies, so this costs the app nothing. Same convention as Crewing (this project's sibling app under the same Simplified Suite) — see its own CLAUDE.md.

**Standing convention: every migration that `CREATE TABLE`s also `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`s it, in the same migration file.** A new table that ships without this line is exposed to the anon key by default — that's the gap to avoid, not a follow-up to schedule. Every table originally created in this project shipped without it (all ten were only caught later by Supabase's security advisor, including `users` and `password_reset_tokens` — the genuinely dangerous ones — and fixed retroactively directly against the live database; see `migrations/0012_backfill_rls.sql`, which records that in migration history too). Don't repeat that gap on the next new table.

## Known open items

Documented in more detail in README's "Still open" section: carnet/delivery-note templates need sign-off against real historical documents, no Postgres backup/retention policy configured, and role-based permissions are intentionally wide open for products/assets pending real usage data.
