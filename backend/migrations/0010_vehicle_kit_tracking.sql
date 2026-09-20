-- Vehicle kit tracking — reuses the existing rack mechanism
-- (migrations/0005_racks_cases.sql) rather than inventing a parallel one:
-- "kit permanently fixed into a vehicle" is structurally identical to
-- "kit permanently fixed into a rack" (an asset's home_rack_id pointing at
-- the container), and a vehicle's own checkout/check-in already cascades
-- to its home_rack_id members for free once container_type is treated the
-- same way rack is throughout internal/handlers/racks_cases.go.
--
-- core_vehicle_id links this asset to Core's shared Vehicle entity
-- (identity: registration, name — see Core's migrations/0009_vehicles.sql)
-- the same way core_client_id/core_person_id link out to Core elsewhere:
-- a bare UUID, no real FK (separate database), nullable (only assets with
-- container_type = 'vehicle' are expected to set it, not enforced by a
-- constraint — same as container_type/home_rack_id's own relationship).
ALTER TYPE container_type ADD VALUE 'vehicle';

ALTER TABLE assets ADD COLUMN core_vehicle_id UUID;
CREATE UNIQUE INDEX idx_assets_core_vehicle_id ON assets(core_vehicle_id) WHERE core_vehicle_id IS NOT NULL;

