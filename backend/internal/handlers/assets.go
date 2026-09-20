package handlers

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"equiptra/internal/models"
)

const assetSelectCols = `
	a.id, a.legacy_id, a.product_id, a.asset_number, a.serial_number, a.is_bulk, a.quantity,
	a.location, a.purchase_price, a.replacement_value, a.purchase_date, a.status, a.notes,
	a.container_type, a.home_rack_id, a.core_vehicle_id, a.created_at, a.updated_at, p.name, p.category, p.image_url,
	EXISTS(SELECT 1 FROM service_records sr WHERE sr.asset_id = a.id AND sr.status IN ('open', 'in_progress')) AS has_open_fault,
	hr.asset_number`

// assetSelectJoins must follow "FROM assets a JOIN products p ON p.id = a.product_id" —
// adds the home-rack lookup used by assetSelectCols' last column.
const assetSelectJoins = `
	LEFT JOIN assets hr ON hr.id = a.home_rack_id`

func scanAsset(row pgx.Row) (models.Asset, error) {
	var asset models.Asset
	err := row.Scan(&asset.ID, &asset.LegacyID, &asset.ProductID, &asset.AssetNumber,
		&asset.SerialNumber, &asset.IsBulk, &asset.Quantity, &asset.Location,
		&asset.PurchasePrice, &asset.ReplacementValue, &asset.PurchaseDate, &asset.Status,
		&asset.Notes, &asset.ContainerType, &asset.HomeRackID, &asset.CoreVehicleID, &asset.CreatedAt, &asset.UpdatedAt,
		&asset.ProductName, &asset.Category, &asset.ProductImageURL,
		&asset.HasOpenFault, &asset.HomeRackAssetNumber)
	return asset, err
}

// ListAssets supports the mockup's search box (name / asset number / serial)
// and category-chip filter.
func (a *API) ListAssets(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	search := q.Get("search")
	category := q.Get("category")
	status := q.Get("status")
	productID := q.Get("product_id")
	containerType := q.Get("container_type")

	rows, err := a.DB.Query(r.Context(), `
		SELECT `+assetSelectCols+`
		FROM assets a
		JOIN products p ON p.id = a.product_id
		`+assetSelectJoins+`
		WHERE ($1 = '' OR p.name ILIKE '%' || $1 || '%'
		           OR a.asset_number ILIKE '%' || $1 || '%'
		           OR a.serial_number ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR p.category = $2)
		  AND ($3 = '' OR a.status::text = $3)
		  AND ($4 = '' OR a.product_id = $4::bigint)
		  AND ($5 = '' OR a.container_type::text = $5)
		ORDER BY p.name, a.asset_number NULLS LAST`,
		search, category, status, productID, containerType,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	assets := []models.Asset{}
	for rows.Next() {
		asset, err := scanAsset(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "scan failed")
			return
		}
		assets = append(assets, asset)
	}
	writeJSON(w, http.StatusOK, assets)
}

func (a *API) GetAsset(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	asset, err := scanAsset(a.DB.QueryRow(r.Context(), `
		SELECT `+assetSelectCols+`
		FROM assets a JOIN products p ON p.id = a.product_id
		`+assetSelectJoins+`
		WHERE a.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "asset not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	writeJSON(w, http.StatusOK, asset)
}

type assetWriteRequest struct {
	ProductID        int64                 `json:"product_id"`
	AssetNumber      *string               `json:"asset_number"`
	SerialNumber     *string               `json:"serial_number"`
	IsBulk           bool                  `json:"is_bulk"`
	Quantity         int                   `json:"quantity"`
	Location         *string               `json:"location"`
	PurchasePrice    *float64              `json:"purchase_price"`
	ReplacementValue *float64              `json:"replacement_value"`
	PurchaseDate     *time.Time            `json:"purchase_date"`
	Status           models.AssetStatus    `json:"status"`
	Notes            *string               `json:"notes"`
	ContainerType    *models.ContainerType `json:"container_type"`
	// HomeRackID is intentionally not read here — see CreateAsset/UpdateAsset.
	HomeRackID    *int64  `json:"home_rack_id"`
	CoreVehicleID *string `json:"core_vehicle_id"`
}

func (a *API) CreateAsset(w http.ResponseWriter, r *http.Request) {
	var req assetWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := validateAssetWrite(req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// home_rack_id is never set at creation — it's edit-only metadata (see
	// the addendum: "Set/cleared only via manual edit") and UpdateAsset is
	// admin-gated while CreateAsset isn't, so accepting it here would let a
	// standard user assign rack membership through the back door.
	var id int64
	err := a.DB.QueryRow(r.Context(), `
		INSERT INTO assets (product_id, asset_number, serial_number, is_bulk, quantity,
		                     location, purchase_price, replacement_value, purchase_date, status, notes, container_type, core_vehicle_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		RETURNING id`,
		req.ProductID, req.AssetNumber, req.SerialNumber, req.IsBulk, quantityOrDefault(req),
		req.Location, req.PurchasePrice, req.ReplacementValue, req.PurchaseDate, statusOrDefault(req), req.Notes,
		req.ContainerType, req.CoreVehicleID,
	).Scan(&id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "insert failed: "+err.Error())
		return
	}

	asset, err := scanAsset(a.DB.QueryRow(r.Context(), `
		SELECT `+assetSelectCols+` FROM assets a JOIN products p ON p.id = a.product_id `+assetSelectJoins+` WHERE a.id = $1`, id))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch after insert failed")
		return
	}
	writeJSON(w, http.StatusCreated, asset)
}

// UpdateAsset is admin-only (see cmd/api/main.go) — the one place
// home_rack_id can be set or cleared, per the addendum.
func (a *API) UpdateAsset(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req assetWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := validateAssetWrite(req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.HomeRackID != nil {
		var rackContainerType *models.ContainerType
		err := a.DB.QueryRow(r.Context(), `SELECT container_type FROM assets WHERE id = $1`, *req.HomeRackID).Scan(&rackContainerType)
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusBadRequest, "home_rack_id does not refer to an existing asset")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "rack lookup failed")
			return
		}
		if !isRackLikeContainer(rackContainerType) {
			writeError(w, http.StatusBadRequest, "home_rack_id must refer to an asset with container_type=rack or container_type=vehicle")
			return
		}
	}

	tag, err := a.DB.Exec(r.Context(), `
		UPDATE assets SET product_id=$1, asset_number=$2, serial_number=$3, is_bulk=$4, quantity=$5,
		       location=$6, purchase_price=$7, replacement_value=$8, purchase_date=$9, status=$10,
		       notes=$11, container_type=$12, home_rack_id=$13, core_vehicle_id=$14, updated_at=now()
		WHERE id=$15`,
		req.ProductID, req.AssetNumber, req.SerialNumber, req.IsBulk, quantityOrDefault(req),
		req.Location, req.PurchasePrice, req.ReplacementValue, req.PurchaseDate, statusOrDefault(req), req.Notes,
		req.ContainerType, req.HomeRackID, req.CoreVehicleID, id,
	)
	if err != nil {
		writeError(w, http.StatusBadRequest, "update failed: "+err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "asset not found")
		return
	}

	asset, err := scanAsset(a.DB.QueryRow(r.Context(), `
		SELECT `+assetSelectCols+` FROM assets a JOIN products p ON p.id = a.product_id `+assetSelectJoins+` WHERE a.id = $1`, id))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch after update failed")
		return
	}
	writeJSON(w, http.StatusOK, asset)
}

func (a *API) DeleteAsset(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM assets WHERE id = $1`, id)
	if err != nil {
		writeError(w, http.StatusConflict, "cannot delete asset with linked bookings/service records")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "asset not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetAssetHistory returns booking history and service records for an asset's
// detail panel, per the mockup.
func (a *API) GetAssetHistory(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	type allocationWithProject struct {
		models.BookingAllocation
		ProjectName string    `json:"project_name"`
		DateOut     time.Time `json:"date_out"`
		DateIn      time.Time `json:"date_in"`
	}

	allocationRows, err := a.DB.Query(r.Context(), `
		SELECT `+allocationSelectCols+`, pr.name, br.date_out, br.date_in
		FROM booking_allocations ba
		JOIN assets a ON a.id = ba.asset_id
		JOIN products p ON p.id = a.product_id
		LEFT JOIN users uo ON uo.id = ba.checked_out_by
		LEFT JOIN users ui ON ui.id = ba.checked_in_by
		LEFT JOIN assets hr ON hr.id = a.home_rack_id
		JOIN booking_requests br ON br.id = ba.booking_request_id
		JOIN projects pr ON pr.id = br.project_id
		WHERE ba.asset_id = $1
		ORDER BY br.date_out DESC`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	allocations := []allocationWithProject{}
	for allocationRows.Next() {
		var wrapped allocationWithProject
		ba := &wrapped.BookingAllocation
		if err := allocationRows.Scan(&ba.ID, &ba.BookingRequestID, &ba.AssetID, &ba.Status, &ba.CheckedOutAt, &ba.CheckedOutBy,
			&ba.InspectionPassed, &ba.ConditionOutNotes, &ba.CheckedInAt, &ba.CheckedInBy,
			&ba.ConditionInNotes, &ba.DamageFlag, &ba.DamageServiceRecordID, &ba.ReturnToHomeRack, &ba.CreatedAt, &ba.UpdatedAt,
			&ba.AssetNumber, &ba.SerialNumber, &ba.IsBulk, &ba.ProductName,
			&ba.CheckedOutByName, &ba.CheckedInByName, &ba.HomeRackID, &ba.HomeRackAssetNumber, &ba.ContainerType,
			&wrapped.ProjectName, &wrapped.DateOut, &wrapped.DateIn); err != nil {
			allocationRows.Close()
			writeError(w, http.StatusInternalServerError, "scan failed")
			return
		}
		allocations = append(allocations, wrapped)
	}
	allocationRows.Close()

	records, err := a.DB.Query(r.Context(), `
		SELECT `+serviceRecordSelectCols+serviceRecordJoins+`
		WHERE sr.asset_id = $1 ORDER BY sr.date_reported DESC`, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer records.Close()
	serviceRecords := []models.ServiceRecord{}
	for records.Next() {
		s, err := scanServiceRecord(records)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "scan failed")
			return
		}
		serviceRecords = append(serviceRecords, s)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"allocations":     allocations,
		"service_records": serviceRecords,
	})
}

func validateAssetWrite(req assetWriteRequest) error {
	if req.ProductID == 0 {
		return errBadRequest("product_id is required")
	}
	if !req.IsBulk && (req.AssetNumber == nil || *req.AssetNumber == "") {
		return errBadRequest("asset_number is required for non-bulk assets")
	}
	return nil
}

func quantityOrDefault(req assetWriteRequest) int {
	if req.IsBulk {
		return req.Quantity
	}
	return 1
}

func statusOrDefault(req assetWriteRequest) models.AssetStatus {
	if req.Status == "" {
		return models.AssetStatusActive
	}
	return req.Status
}

type errBadRequest string

func (e errBadRequest) Error() string { return string(e) }
