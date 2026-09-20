package handlers

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"equiptra/internal/models"
)

// Contract-level defaults — a starting-point template of kit/equipment
// needs (product + quantity) for a Core Contract, applied to a new
// Project's booking_requests when it's created under that Contract (see
// applyContractDefaults, called from CreateProject in projects.go). This
// file is plain CRUD on the template itself.

// ListContractsWithDefaults backs the "browse existing Contracts that
// already have defaults set" list on the Contract defaults screen, so a
// user can find and edit one without already knowing its name.
func (a *API) ListContractsWithDefaults(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `
		SELECT shared_contract_id, shared_contract_name, count(*)
		FROM contract_defaults
		GROUP BY shared_contract_id, shared_contract_name
		ORDER BY shared_contract_name`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	contracts := []models.ContractWithDefaults{}
	for rows.Next() {
		var c models.ContractWithDefaults
		if err := rows.Scan(&c.SharedContractID, &c.SharedContractName, &c.DefaultCount); err != nil {
			writeError(w, http.StatusInternalServerError, "scan failed")
			return
		}
		contracts = append(contracts, c)
	}
	writeJSON(w, http.StatusOK, contracts)
}

const contractDefaultSelectCols = `
	cd.id, cd.shared_contract_id, cd.shared_contract_name, cd.product_id, cd.quantity, cd.created_at, cd.updated_at,
	p.name, p.category`

func scanContractDefault(row pgx.Row) (models.ContractDefault, error) {
	var d models.ContractDefault
	err := row.Scan(&d.ID, &d.SharedContractID, &d.SharedContractName, &d.ProductID, &d.Quantity, &d.CreatedAt, &d.UpdatedAt,
		&d.ProductName, &d.Category)
	return d, err
}

// ListContractDefaults returns one Contract's kit defaults, joined with
// the product's own name/category for display.
func (a *API) ListContractDefaults(w http.ResponseWriter, r *http.Request) {
	sharedContractID := r.URL.Query().Get("shared_contract_id")
	if sharedContractID == "" {
		writeError(w, http.StatusBadRequest, "shared_contract_id is required")
		return
	}
	rows, err := a.DB.Query(r.Context(), `
		SELECT `+contractDefaultSelectCols+`
		FROM contract_defaults cd JOIN products p ON p.id = cd.product_id
		WHERE cd.shared_contract_id = $1
		ORDER BY p.name`, sharedContractID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	defaults := []models.ContractDefault{}
	for rows.Next() {
		d, err := scanContractDefault(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "scan failed")
			return
		}
		defaults = append(defaults, d)
	}
	writeJSON(w, http.StatusOK, defaults)
}

type contractDefaultWriteRequest struct {
	SharedContractID   string `json:"shared_contract_id"`
	SharedContractName string `json:"shared_contract_name"`
	ProductID          int64  `json:"product_id"`
	Quantity           int    `json:"quantity"`
}

// UpsertContractDefault both adds a new kit default and adjusts an
// existing one's quantity — ON CONFLICT keeps "add a product" and "adjust
// quantity" as the same one call, matching the UNIQUE(shared_contract_id,
// product_id) constraint's own "one row per product per Contract" shape.
func (a *API) UpsertContractDefault(w http.ResponseWriter, r *http.Request) {
	var req contractDefaultWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.SharedContractID == "" || req.SharedContractName == "" || req.ProductID == 0 {
		writeError(w, http.StatusBadRequest, "shared_contract_id, shared_contract_name and product_id are required")
		return
	}
	if req.Quantity <= 0 {
		writeError(w, http.StatusBadRequest, "quantity must be greater than zero")
		return
	}

	var id int64
	err := a.DB.QueryRow(r.Context(), `
		INSERT INTO contract_defaults (shared_contract_id, shared_contract_name, product_id, quantity)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (shared_contract_id, product_id) DO UPDATE
		    SET quantity = EXCLUDED.quantity, shared_contract_name = EXCLUDED.shared_contract_name, updated_at = now()
		RETURNING id`,
		req.SharedContractID, req.SharedContractName, req.ProductID, req.Quantity,
	).Scan(&id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to save default: "+err.Error())
		return
	}

	d, err := scanContractDefault(a.DB.QueryRow(r.Context(), `
		SELECT `+contractDefaultSelectCols+`
		FROM contract_defaults cd JOIN products p ON p.id = cd.product_id
		WHERE cd.id = $1`, id))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch after save failed")
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

func (a *API) DeleteContractDefault(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM contract_defaults WHERE id = $1`, id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to delete default")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "default not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// applyContractDefaults seeds a freshly-created Project's booking_requests
// from its Contract's stored defaults, if any exist — a starting point
// only, exactly like a manually-created booking_request (fully
// editable/removable afterward). Called from CreateProject; failures are
// logged and swallowed by the caller rather than failing the whole
// project creation, same graceful-degradation principle as a missing
// org_buyout_settings row elsewhere in this codebase family. dateOut/
// dateIn come from the new project's own start_date/end_date, since a
// default row stores no date range of its own.
func applyContractDefaults(ctx context.Context, db *pgxpool.Pool, projectID int64, sharedContractID string, dateOut, dateIn time.Time) error {
	rows, err := db.Query(ctx, `SELECT product_id, quantity FROM contract_defaults WHERE shared_contract_id = $1`, sharedContractID)
	if err != nil {
		return err
	}
	type line struct {
		productID int64
		quantity  int
	}
	var lines []line
	for rows.Next() {
		var l line
		if err := rows.Scan(&l.productID, &l.quantity); err != nil {
			rows.Close()
			return err
		}
		lines = append(lines, l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(lines) == 0 {
		return nil
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, l := range lines {
		// Same status/shortage logic CreateBookingRequest applies when
		// product_id is set — a default always has one.
		shortage, err := computeShortage(ctx, db, l.productID, l.quantity, dateOut, dateIn, nil)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO booking_requests (project_id, product_id, quantity_requested, date_out, date_in, status, shortage_flag)
			VALUES ($1, $2, $3, $4, $5, 'reserved', $6)`,
			projectID, l.productID, l.quantity, dateOut, dateIn, shortage,
		); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
