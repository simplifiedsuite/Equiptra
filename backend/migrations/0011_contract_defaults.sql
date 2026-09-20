-- Contract-level defaults, Equipment side: a starting-point template of
-- kit/equipment needs (product + quantity) for a Core Contract, applied to
-- a new Project's booking_requests when it's created under that Contract.
-- Keyed by shared_contract_id — a bare UUID, no FK (Core is a separate
-- database), same convention as projects.core_client_id/shared_contract_id
-- and Ralto's job_core_vehicles.core_vehicle_id. shared_contract_name is
-- cached at the time a default is set, same "not live-refreshed"
-- philosophy as everywhere else this pattern is used.
--
-- One row per product default per Contract: UNIQUE(shared_contract_id,
-- product_id) so "adjust quantity" is a plain upsert, not a second row.
CREATE TABLE contract_defaults (
    id                    BIGSERIAL PRIMARY KEY,
    shared_contract_id    UUID NOT NULL,
    shared_contract_name  TEXT NOT NULL,
    product_id            BIGINT NOT NULL REFERENCES products(id),
    quantity              INTEGER NOT NULL CHECK (quantity > 0),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (shared_contract_id, product_id)
);

CREATE INDEX idx_contract_defaults_shared_contract_id ON contract_defaults(shared_contract_id);
