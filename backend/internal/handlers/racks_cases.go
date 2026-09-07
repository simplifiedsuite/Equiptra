package handlers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"equiptra/internal/middleware"
	"equiptra/internal/models"
)

// cascadeContentItem is one asset that will get its own real booking_allocation
// when a rack/case is checked out — see docs/equiptra-racks-cases-addendum.md.
type cascadeContentItem struct {
	AssetID     int64
	ProductID   int64
	IsBulk      bool
	AssetNumber *string
}

// cascadeSkip explains why a content item was left out of the cascade
// entirely (not active, or has an open fault) — matches CreateAllocation's
// own eligibility rules, applied per-item so one bad item doesn't block the
// rest of a rack/case from going out.
type cascadeSkip struct {
	AssetID     int64   `json:"asset_id"`
	AssetNumber *string `json:"asset_number"`
	Reason      string  `json:"reason"`
}

// cascadeConflict is a content item that's already committed elsewhere for
// an overlapping date range (or would over-allocate a bulk asset) — the
// container checkout is blocked on these unless the caller passes override.
type cascadeConflict struct {
	AssetID       int64                `json:"asset_id"`
	AssetNumber   *string              `json:"asset_number"`
	Conflicts     []AllocationConflict `json:"conflicts,omitempty"`
	OverAllocated bool                 `json:"over_allocated,omitempty"`
}

type cascadePlan struct {
	Items     []cascadeContentItem
	Skipped   []cascadeSkip
	Conflicts []cascadeConflict
}

// planContainerCascade gathers a rack/case's current contents and checks
// each one's eligibility (active, no open fault) and availability
// (date-overlap conflict / bulk over-allocation) for the container's own
// booking dates — read-only, safe to call before committing to the
// container's own checkout.
func planContainerCascade(ctx context.Context, db dbExecutor, containerAssetID int64, containerType models.ContainerType, caseAllocationID int64, dateOut, dateIn time.Time) (*cascadePlan, error) {
	var rows pgx.Rows
	var err error
	if containerType == models.ContainerTypeRack {
		rows, err = db.Query(ctx, `
			SELECT a.id, a.product_id, a.is_bulk, a.asset_number, a.status,
			       EXISTS(SELECT 1 FROM service_records sr WHERE sr.asset_id = a.id AND sr.status IN ('open', 'in_progress'))
			FROM assets a
			WHERE a.home_rack_id = $1`, containerAssetID)
	} else {
		rows, err = db.Query(ctx, `
			SELECT a.id, a.product_id, a.is_bulk, a.asset_number, a.status,
			       EXISTS(SELECT 1 FROM service_records sr WHERE sr.asset_id = a.id AND sr.status IN ('open', 'in_progress'))
			FROM case_contents cc
			JOIN assets a ON a.id = cc.content_asset_id
			WHERE cc.booking_allocation_id = $1`, caseAllocationID)
	}
	if err != nil {
		return nil, err
	}

	type candidate struct {
		item     cascadeContentItem
		status   models.AssetStatus
		hasFault bool
	}
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.item.AssetID, &c.item.ProductID, &c.item.IsBulk, &c.item.AssetNumber, &c.status, &c.hasFault); err != nil {
			rows.Close()
			return nil, err
		}
		candidates = append(candidates, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	plan := &cascadePlan{}
	for _, c := range candidates {
		if c.status != models.AssetStatusActive {
			plan.Skipped = append(plan.Skipped, cascadeSkip{AssetID: c.item.AssetID, AssetNumber: c.item.AssetNumber, Reason: "not active (" + string(c.status) + ")"})
			continue
		}
		if c.hasFault {
			plan.Skipped = append(plan.Skipped, cascadeSkip{AssetID: c.item.AssetID, AssetNumber: c.item.AssetNumber, Reason: "has an open or in-progress fault"})
			continue
		}
		if c.item.IsBulk {
			count, err := bulkOverAllocationCount(ctx, db, c.item.AssetID, dateOut, dateIn, nil)
			if err != nil {
				return nil, err
			}
			var quantity int
			if err := db.QueryRow(ctx, `SELECT quantity FROM assets WHERE id = $1`, c.item.AssetID).Scan(&quantity); err != nil {
				return nil, err
			}
			if count+1 > quantity {
				plan.Conflicts = append(plan.Conflicts, cascadeConflict{AssetID: c.item.AssetID, AssetNumber: c.item.AssetNumber, OverAllocated: true})
				continue
			}
		} else {
			conflicts, err := findAllocationConflicts(ctx, db, c.item.AssetID, dateOut, dateIn, nil)
			if err != nil {
				return nil, err
			}
			if len(conflicts) > 0 {
				plan.Conflicts = append(plan.Conflicts, cascadeConflict{AssetID: c.item.AssetID, AssetNumber: c.item.AssetNumber, Conflicts: conflicts})
				continue
			}
		}
		plan.Items = append(plan.Items, c.item)
	}
	return plan, nil
}

// applyContainerCascade creates one booking_request per distinct product
// among plan.Items (same project/dates as the container's own request) and
// a real, immediately-checked-out booking_allocation for each item under
// it — reusing the existing allocation machinery rather than a
// container-level status field, per the addendum. Must run inside the same
// transaction as the container's own checkout so a failure rolls back both
// together.
func applyContainerCascade(ctx context.Context, tx pgx.Tx, plan *cascadePlan, containerType models.ContainerType, projectID int64, dateOut, dateIn time.Time, checkedOutBy int64) error {
	byProduct := map[int64][]cascadeContentItem{}
	var order []int64
	for _, item := range plan.Items {
		if _, ok := byProduct[item.ProductID]; !ok {
			order = append(order, item.ProductID)
		}
		byProduct[item.ProductID] = append(byProduct[item.ProductID], item)
	}

	// Rack members travel out attached to their own rack, not pulled
	// individually — return_to_home_rack is only meaningful for a solo pull,
	// so it's forced false here regardless of the column's default. Case
	// contents keep the default true: an item can live in a rack AND be
	// packed into a case for this job, in which case it genuinely is being
	// pulled from its rack.
	returnToHomeRack := containerType != models.ContainerTypeRack

	for _, productID := range order {
		items := byProduct[productID]
		var requestID int64
		err := tx.QueryRow(ctx, `
			INSERT INTO booking_requests (project_id, product_id, quantity_requested, date_out, date_in, status)
			VALUES ($1, $2, $3, $4, $5, 'out')
			RETURNING id`,
			projectID, productID, len(items), dateOut, dateIn,
		).Scan(&requestID)
		if err != nil {
			return fmt.Errorf("creating cascade booking_request for product %d: %w", productID, err)
		}
		for _, item := range items {
			_, err := tx.Exec(ctx, `
				INSERT INTO booking_allocations
					(booking_request_id, asset_id, status, checked_out_at, checked_out_by, inspection_passed, return_to_home_rack)
				VALUES ($1, $2, 'checked_out', now(), $3, true, $4)`,
				requestID, item.AssetID, checkedOutBy, returnToHomeRack,
			)
			if err != nil {
				return fmt.Errorf("creating cascade allocation for asset %d: %w", item.AssetID, err)
			}
		}
	}
	return nil
}

// cascadeCheckin finds the booking_allocations created by applyContainerCascade
// for this container (re-derived from current home_rack_id / case_contents
// membership rather than a stored link, since none is needed) and checks
// each one in. For a case, the case_contents rows are then deleted — empty
// again for next time. For a rack, home_rack_id is left untouched.
func cascadeCheckin(ctx context.Context, tx pgx.Tx, containerAssetID int64, containerType models.ContainerType, caseAllocationID int64, checkedInBy int64) error {
	var rows pgx.Rows
	var err error
	if containerType == models.ContainerTypeRack {
		rows, err = tx.Query(ctx, `
			SELECT ba.id FROM booking_allocations ba
			JOIN assets a ON a.id = ba.asset_id
			WHERE a.home_rack_id = $1 AND ba.status = 'checked_out'`, containerAssetID)
	} else {
		rows, err = tx.Query(ctx, `
			SELECT ba.id
			FROM case_contents cc
			JOIN booking_allocations ba ON ba.asset_id = cc.content_asset_id AND ba.status = 'checked_out'
			WHERE cc.booking_allocation_id = $1`, caseAllocationID)
	}
	if err != nil {
		return err
	}
	var allocationIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		allocationIDs = append(allocationIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, id := range allocationIDs {
		var requestID int64
		err := tx.QueryRow(ctx, `
			UPDATE booking_allocations SET status = 'returned', checked_in_at = now(), checked_in_by = $1, updated_at = now()
			WHERE id = $2 RETURNING booking_request_id`, checkedInBy, id,
		).Scan(&requestID)
		if err != nil {
			return fmt.Errorf("checking in cascaded allocation %d: %w", id, err)
		}
		if err := recomputeBookingRequestStatus(ctx, tx, requestID); err != nil {
			return err
		}
	}

	if containerType == models.ContainerTypeCase {
		if _, err := tx.Exec(ctx, `DELETE FROM case_contents WHERE booking_allocation_id = $1`, caseAllocationID); err != nil {
			return err
		}
	}
	return nil
}

// --- Rack members ---

// ListRackMembers returns every asset currently living in a rack — the
// rack's own AssetDetailPanel uses this to show its kit contents.
func (a *API) ListRackMembers(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	rows, err := a.DB.Query(r.Context(), `
		SELECT `+assetSelectCols+`
		FROM assets a JOIN products p ON p.id = a.product_id
		`+assetSelectJoins+`
		WHERE a.home_rack_id = $1
		ORDER BY p.name, a.asset_number NULLS LAST`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	members := []models.Asset{}
	for rows.Next() {
		asset, err := scanAsset(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "scan failed")
			return
		}
		members = append(members, asset)
	}
	writeJSON(w, http.StatusOK, members)
}

type swapRackMemberRequest struct {
	OldAssetID int64 `json:"old_asset_id"`
	NewAssetID int64 `json:"new_asset_id"`
}

// SwapRackMember is the fault-swap mechanism for racks: clears home_rack_id
// on the faulty item and sets it on the replacement, in one transaction so
// the kit is never left inconsistent partway through. Admin-only (see
// cmd/api/main.go) — rack membership is permanent kit structure, same
// access tier as the asset-edit screen. The fault itself is reported
// separately via the existing service_records path; this endpoint only
// moves the container-membership link.
func (a *API) SwapRackMember(w http.ResponseWriter, r *http.Request) {
	rackID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req swapRackMemberRequest
	if err := readJSON(r, &req); err != nil || req.OldAssetID == 0 || req.NewAssetID == 0 {
		writeError(w, http.StatusBadRequest, "old_asset_id and new_asset_id are required")
		return
	}

	var rackContainerType *models.ContainerType
	if err := a.DB.QueryRow(r.Context(), `SELECT container_type FROM assets WHERE id = $1`, rackID).Scan(&rackContainerType); errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "rack not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	if rackContainerType == nil || *rackContainerType != models.ContainerTypeRack {
		writeError(w, http.StatusBadRequest, "asset is not a rack")
		return
	}

	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "swap failed")
		return
	}
	defer tx.Rollback(r.Context())

	tag, err := tx.Exec(r.Context(), `UPDATE assets SET home_rack_id = NULL, updated_at = now() WHERE id = $1 AND home_rack_id = $2`, req.OldAssetID, rackID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "swap failed: "+err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusBadRequest, "old_asset_id is not currently a member of this rack")
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE assets SET home_rack_id = $1, updated_at = now() WHERE id = $2`, rackID, req.NewAssetID); err != nil {
		writeError(w, http.StatusInternalServerError, "swap failed: "+err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "swap failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "swapped"})
}

type addRackMemberRequest struct {
	AssetID int64 `json:"asset_id"`
}

// AddRackMember sets home_rack_id on an asset to this rack — the write side
// of ListRackMembers's read-only display, built for the scan-to-add
// workflow on the rack's own detail panel: building a rack physically means
// scanning items onto it one at a time, not opening each item's own edit
// screen. Admin-only (see cmd/api/main.go), same tier as SwapRackMember and
// the asset-edit screen — rack membership is permanent kit structure.
// Idempotent: re-adding an asset already on this rack is a harmless no-op,
// so a duplicate scan doesn't need special handling.
func (a *API) AddRackMember(w http.ResponseWriter, r *http.Request) {
	rackID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req addRackMemberRequest
	if err := readJSON(r, &req); err != nil || req.AssetID == 0 {
		writeError(w, http.StatusBadRequest, "asset_id is required")
		return
	}
	if req.AssetID == rackID {
		writeError(w, http.StatusBadRequest, "a rack cannot contain itself")
		return
	}

	var rackContainerType *models.ContainerType
	if err := a.DB.QueryRow(r.Context(), `SELECT container_type FROM assets WHERE id = $1`, rackID).Scan(&rackContainerType); errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "rack not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	if rackContainerType == nil || *rackContainerType != models.ContainerTypeRack {
		writeError(w, http.StatusBadRequest, "asset is not a rack")
		return
	}

	tag, err := a.DB.Exec(r.Context(), `UPDATE assets SET home_rack_id = $1, updated_at = now() WHERE id = $2`, rackID, req.AssetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "add failed: "+err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "asset not found")
		return
	}

	asset, err := scanAsset(a.DB.QueryRow(r.Context(), `
		SELECT `+assetSelectCols+` FROM assets a JOIN products p ON p.id = a.product_id `+assetSelectJoins+` WHERE a.id = $1`, req.AssetID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch after add failed")
		return
	}
	writeJSON(w, http.StatusOK, asset)
}

// RemoveRackMember clears home_rack_id — the plain removal direction
// paired with AddRackMember. Only succeeds if the asset is currently a
// member of this specific rack, same safety guard as SwapRackMember's old
// side.
func (a *API) RemoveRackMember(w http.ResponseWriter, r *http.Request) {
	rackID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	assetID, err := strconv.ParseInt(chi.URLParam(r, "assetId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid asset id")
		return
	}
	tag, err := a.DB.Exec(r.Context(), `UPDATE assets SET home_rack_id = NULL, updated_at = now() WHERE id = $1 AND home_rack_id = $2`, assetID, rackID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "remove failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "asset is not currently a member of this rack")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Case contents ---

const caseContentsSelectCols = `
	cc.id, cc.case_asset_id, cc.content_asset_id, cc.booking_allocation_id, cc.created_at,
	a.asset_number, a.serial_number, p.name`

func scanCaseContents(row pgx.Row) (models.CaseContents, error) {
	var cc models.CaseContents
	err := row.Scan(&cc.ID, &cc.CaseAssetID, &cc.ContentAssetID, &cc.BookingAllocationID, &cc.CreatedAt,
		&cc.ContentAssetNumber, &cc.ContentSerialNumber, &cc.ContentProductName)
	return cc, err
}

// caseAllocationContext looks up the case's own asset/product/dates for a
// given booking_allocation, and confirms it's actually a case — shared by
// every case_contents endpoint below.
func caseAllocationContext(ctx context.Context, db dbExecutor, caseAllocationID int64) (caseAssetID int64, dateOut, dateIn time.Time, err error) {
	var containerType *models.ContainerType
	err = db.QueryRow(ctx, `
		SELECT a.id, a.container_type, br.date_out, br.date_in
		FROM booking_allocations ba
		JOIN assets a ON a.id = ba.asset_id
		JOIN booking_requests br ON br.id = ba.booking_request_id
		WHERE ba.id = $1`, caseAllocationID,
	).Scan(&caseAssetID, &containerType, &dateOut, &dateIn)
	if err != nil {
		return 0, time.Time{}, time.Time{}, err
	}
	if containerType == nil || *containerType != models.ContainerTypeCase {
		return 0, time.Time{}, time.Time{}, errBadRequest("allocation is not for a case")
	}
	return caseAssetID, dateOut, dateIn, nil
}

// ListCaseContents shows what's currently packed for this booking.
func (a *API) ListCaseContents(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	rows, err := a.DB.Query(r.Context(), `
		SELECT `+caseContentsSelectCols+`
		FROM case_contents cc
		JOIN assets a ON a.id = cc.content_asset_id
		JOIN products p ON p.id = a.product_id
		WHERE cc.booking_allocation_id = $1
		ORDER BY p.name, a.asset_number NULLS LAST`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	contents := []models.CaseContents{}
	for rows.Next() {
		cc, err := scanCaseContents(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "scan failed")
			return
		}
		contents = append(contents, cc)
	}
	writeJSON(w, http.StatusOK, contents)
}

type packCaseRequest struct {
	ContentAssetID int64 `json:"content_asset_id"`
	Override       bool  `json:"override"`
}

// AddCaseContent is the pack-out step for a case — records intent to pack
// content_asset_id for this specific job. The item's own booking_allocation
// isn't created until the case itself is checked out (applyContainerCascade);
// this just runs the same eligibility/conflict pre-check CreateAllocation
// does, so a doomed pack attempt is caught early rather than at checkout.
func (a *API) AddCaseContent(w http.ResponseWriter, r *http.Request) {
	caseAllocationID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req packCaseRequest
	if err := readJSON(r, &req); err != nil || req.ContentAssetID == 0 {
		writeError(w, http.StatusBadRequest, "content_asset_id is required")
		return
	}

	caseAssetID, dateOut, dateIn, err := caseAllocationContext(r.Context(), a.DB, caseAllocationID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "case allocation not found")
		return
	}
	var badReq errBadRequest
	if errors.As(err, &badReq) {
		writeError(w, http.StatusBadRequest, badReq.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	if req.ContentAssetID == caseAssetID {
		writeError(w, http.StatusBadRequest, "a case cannot contain itself")
		return
	}

	var status models.AssetStatus
	var hasFault bool
	var isBulk bool
	err = a.DB.QueryRow(r.Context(), `
		SELECT status, is_bulk, EXISTS(SELECT 1 FROM service_records sr WHERE sr.asset_id = assets.id AND sr.status IN ('open', 'in_progress'))
		FROM assets WHERE id = $1`, req.ContentAssetID,
	).Scan(&status, &isBulk, &hasFault)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "content asset not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	if status != models.AssetStatusActive {
		writeError(w, http.StatusBadRequest, "asset is not active ("+string(status)+")")
		return
	}
	if hasFault {
		writeError(w, http.StatusBadRequest, "asset has an open or in-progress fault and cannot be packed")
		return
	}

	if !req.Override {
		if isBulk {
			count, err := bulkOverAllocationCount(r.Context(), a.DB, req.ContentAssetID, dateOut, dateIn, nil)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "availability check failed")
				return
			}
			var quantity int
			if err := a.DB.QueryRow(r.Context(), `SELECT quantity FROM assets WHERE id = $1`, req.ContentAssetID).Scan(&quantity); err != nil {
				writeError(w, http.StatusInternalServerError, "query failed")
				return
			}
			if count+1 > quantity {
				writeJSON(w, http.StatusConflict, map[string]interface{}{
					"error":   "over-allocation",
					"message": "packing this would exceed the bulk stock currently held for overlapping dates",
				})
				return
			}
		} else {
			conflicts, err := findAllocationConflicts(r.Context(), a.DB, req.ContentAssetID, dateOut, dateIn, nil)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "conflict check failed")
				return
			}
			if len(conflicts) > 0 {
				writeJSON(w, http.StatusConflict, map[string]interface{}{
					"error":     "allocation conflict",
					"conflicts": conflicts,
				})
				return
			}
		}
	}

	var id int64
	err = a.DB.QueryRow(r.Context(), `
		INSERT INTO case_contents (case_asset_id, content_asset_id, booking_allocation_id)
		VALUES ($1, $2, $3) RETURNING id`, caseAssetID, req.ContentAssetID, caseAllocationID,
	).Scan(&id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "pack failed: "+err.Error())
		return
	}

	cc, err := scanCaseContents(a.DB.QueryRow(r.Context(), `
		SELECT `+caseContentsSelectCols+`
		FROM case_contents cc JOIN assets a ON a.id = cc.content_asset_id JOIN products p ON p.id = a.product_id
		WHERE cc.id = $1`, id))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch after insert failed")
		return
	}
	writeJSON(w, http.StatusCreated, cc)
}

// RemoveCaseContent un-packs an item before checkout, or swaps it out for a
// fault mid-job — either way it's just removing this case_contents row; the
// item's own allocation doesn't exist yet if the case hasn't been checked
// out, and if it has, use SwapCaseContent instead so a replacement goes in
// at the same time.
func (a *API) RemoveCaseContent(w http.ResponseWriter, r *http.Request) {
	caseAllocationID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	contentAssetID, err := strconv.ParseInt(chi.URLParam(r, "contentAssetId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid content asset id")
		return
	}
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM case_contents WHERE booking_allocation_id = $1 AND content_asset_id = $2`, caseAllocationID, contentAssetID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "unpack failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "content item not found in this case")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type swapCaseContentRequest struct {
	OldContentAssetID int64 `json:"old_content_asset_id"`
	NewContentAssetID int64 `json:"new_content_asset_id"`
	Override          bool  `json:"override"`
}

// SwapCaseContent is the fault-swap mechanism for cases — same underlying
// operation as SwapRackMember (clear old link, set new link) but scoped to
// just this job's case_contents row, so it naturally disappears at check-in
// along with the rest of the case's contents rather than persisting. If the
// case has already been checked out (the old item has its own cascaded
// allocation), that allocation is checked in as a mistaken pick and the new
// item gets a fresh one, immediately checked out, in the same transaction.
func (a *API) SwapCaseContent(w http.ResponseWriter, r *http.Request) {
	caseAllocationID, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req swapCaseContentRequest
	if err := readJSON(r, &req); err != nil || req.OldContentAssetID == 0 || req.NewContentAssetID == 0 {
		writeError(w, http.StatusBadRequest, "old_content_asset_id and new_content_asset_id are required")
		return
	}

	_, dateOut, dateIn, err := caseAllocationContext(r.Context(), a.DB, caseAllocationID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "case allocation not found")
		return
	}
	var badReq errBadRequest
	if errors.As(err, &badReq) {
		writeError(w, http.StatusBadRequest, badReq.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}

	if !req.Override {
		conflicts, err := findAllocationConflicts(r.Context(), a.DB, req.NewContentAssetID, dateOut, dateIn, nil)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "conflict check failed")
			return
		}
		if len(conflicts) > 0 {
			writeJSON(w, http.StatusConflict, map[string]interface{}{"error": "allocation conflict", "conflicts": conflicts})
			return
		}
	}

	claims, _ := middleware.UserFromContext(r.Context())

	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "swap failed")
		return
	}
	defer tx.Rollback(r.Context())

	tag, err := tx.Exec(r.Context(), `
		UPDATE case_contents SET content_asset_id = $1
		WHERE booking_allocation_id = $2 AND content_asset_id = $3`,
		req.NewContentAssetID, caseAllocationID, req.OldContentAssetID,
	)
	if err != nil {
		writeError(w, http.StatusBadRequest, "swap failed: "+err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusBadRequest, "old_content_asset_id is not currently packed in this case")
		return
	}

	// If the case has already been checked out, the old item's own cascaded
	// allocation exists and is checked_out — check it in (mistaken pick,
	// not a real return) and cascade the new item the same way checkout does.
	var oldAllocationID int64
	err = tx.QueryRow(r.Context(), `
		SELECT id FROM booking_allocations WHERE asset_id = $1 AND status = 'checked_out'`, req.OldContentAssetID,
	).Scan(&oldAllocationID)
	if err == nil {
		var oldRequestID int64
		if err := tx.QueryRow(r.Context(), `
			UPDATE booking_allocations SET status = 'returned', checked_in_at = now(), checked_in_by = $1, updated_at = now()
			WHERE id = $2 RETURNING booking_request_id`, claims.UserID, oldAllocationID,
		).Scan(&oldRequestID); err != nil {
			writeError(w, http.StatusInternalServerError, "swap failed: "+err.Error())
			return
		}
		if err := recomputeBookingRequestStatus(r.Context(), tx, oldRequestID); err != nil {
			writeError(w, http.StatusInternalServerError, "swap failed: "+err.Error())
			return
		}

		var projectID int64
		var productID int64
		if err := tx.QueryRow(r.Context(), `
			SELECT br.project_id, a.product_id FROM booking_requests br, assets a
			WHERE br.id = $1 AND a.id = $2`, oldRequestID, req.NewContentAssetID,
		).Scan(&projectID, &productID); err != nil {
			writeError(w, http.StatusInternalServerError, "swap failed: "+err.Error())
			return
		}
		plan := &cascadePlan{Items: []cascadeContentItem{{AssetID: req.NewContentAssetID, ProductID: productID}}}
		if err := applyContainerCascade(r.Context(), tx, plan, models.ContainerTypeCase, projectID, dateOut, dateIn, claims.UserID); err != nil {
			writeError(w, http.StatusInternalServerError, "swap failed: "+err.Error())
			return
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "swap failed: "+err.Error())
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "swap failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "swapped"})
}

// MarkReturnedToHomeRack clears the return_to_home_rack reminder once staff
// confirm a pulled rack item has actually gone back in — a plain
// confirmation, not a status transition, so it works regardless of the
// allocation's current status (the reminder can be confirmed at check-in
// time or any time after).
func (a *API) MarkReturnedToHomeRack(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	tag, err := a.DB.Exec(r.Context(), `UPDATE booking_allocations SET return_to_home_rack = false, updated_at = now() WHERE id = $1`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "update failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "allocation not found")
		return
	}
	allocations, err := queryAllocations(r.Context(), a.DB, `WHERE ba.id = $1`, id)
	if err != nil || len(allocations) == 0 {
		writeError(w, http.StatusInternalServerError, "fetch after update failed")
		return
	}
	writeJSON(w, http.StatusOK, allocations[0])
}
