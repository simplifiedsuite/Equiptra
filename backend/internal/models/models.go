package models

import "time"

type AssetStatus string

const (
	AssetStatusActive     AssetStatus = "active"
	AssetStatusWrittenOff AssetStatus = "written_off"
	AssetStatusSold       AssetStatus = "sold"
	AssetStatusMissing    AssetStatus = "missing"
)

type ContainerType string

const (
	ContainerTypeRack    ContainerType = "rack"
	ContainerTypeCase    ContainerType = "case"
	ContainerTypeVehicle ContainerType = "vehicle"
)

type ProjectStatus string

const (
	ProjectStatusTentative  ProjectStatus = "tentative"
	ProjectStatusConfirmed  ProjectStatus = "confirmed"
	ProjectStatusInProgress ProjectStatus = "in_progress"
	ProjectStatusCompleted  ProjectStatus = "completed"
	ProjectStatusCancelled  ProjectStatus = "cancelled"
)

type BookingRequestStatus string

const (
	BookingRequestStatusDraft              BookingRequestStatus = "draft"
	BookingRequestStatusReserved           BookingRequestStatus = "reserved"
	BookingRequestStatusPartiallyAllocated BookingRequestStatus = "partially_allocated"
	BookingRequestStatusOut                BookingRequestStatus = "out"
	BookingRequestStatusReturned           BookingRequestStatus = "returned"
	BookingRequestStatusCancelled          BookingRequestStatus = "cancelled"
)

type BookingAllocationStatus string

const (
	BookingAllocationStatusAllocated  BookingAllocationStatus = "allocated"
	BookingAllocationStatusCheckedOut BookingAllocationStatus = "checked_out"
	BookingAllocationStatusReturned   BookingAllocationStatus = "returned"
)

type ServiceStatus string

const (
	ServiceStatusOpen ServiceStatus = "open"
	// ServiceStatusUnderInvestigation is deprecated — left in place for any
	// historic rows, but no longer written by new code. Use
	// ServiceStatusInProgress instead.
	ServiceStatusUnderInvestigation ServiceStatus = "under_investigation"
	ServiceStatusInProgress         ServiceStatus = "in_progress"
	ServiceStatusResolved           ServiceStatus = "resolved"
)

type ServiceSource string

const (
	// ServiceSourceMondayReport is deprecated — the Monday.com relay is
	// retired. Left in place for historic rows; nothing writes it going
	// forward. Use ServiceSourceFieldReport instead.
	ServiceSourceMondayReport  ServiceSource = "monday_report"
	ServiceSourceCheckinDamage ServiceSource = "checkin_damage"
	ServiceSourceFieldReport   ServiceSource = "field_report"
)

type UserRole string

const (
	UserRoleAdmin    UserRole = "admin"
	UserRoleStandard UserRole = "standard"
)

type Product struct {
	ID                  int64     `json:"id"`
	LegacyID            *int      `json:"legacy_id,omitempty"`
	Name                string    `json:"name"`
	Category            *string   `json:"category,omitempty"`
	Manufacturer        *string   `json:"manufacturer,omitempty"`
	WeightKg            *float64  `json:"weight_kg,omitempty"`
	CountryOfOriginCode *string   `json:"country_of_origin_code,omitempty"`
	IsAccessory         bool      `json:"is_accessory"`
	Barcode             *string   `json:"barcode,omitempty"`
	ImageURL            *string   `json:"image_url,omitempty"`
	Description         *string   `json:"description,omitempty"`
	Active              bool      `json:"active"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

type Asset struct {
	ID               int64       `json:"id"`
	LegacyID         *int        `json:"legacy_id,omitempty"`
	ProductID        int64       `json:"product_id"`
	AssetNumber      *string     `json:"asset_number,omitempty"`
	SerialNumber     *string     `json:"serial_number,omitempty"`
	IsBulk           bool        `json:"is_bulk"`
	Quantity         int         `json:"quantity"`
	Location         *string     `json:"location,omitempty"`
	PurchasePrice    *float64    `json:"purchase_price,omitempty"`
	ReplacementValue *float64    `json:"replacement_value,omitempty"`
	PurchaseDate     *time.Time  `json:"purchase_date,omitempty"`
	Status           AssetStatus `json:"status"`
	Notes            *string     `json:"notes,omitempty"`
	// ContainerType marks this asset as a rack or case; nil for an ordinary
	// (non-container) asset. See docs/equiptra-racks-cases-addendum.md.
	ContainerType *ContainerType `json:"container_type,omitempty"`
	// HomeRackID is this asset's permanent rack (or vehicle) membership, if
	// any — set and cleared only via manual edit (admin-only), never at
	// creation.
	HomeRackID *int64 `json:"home_rack_id,omitempty"`
	// CoreVehicleID links this asset to Core's shared Vehicle entity when
	// ContainerType is "vehicle" — see migrations/0010_vehicle_kit_tracking.sql.
	CoreVehicleID *string   `json:"core_vehicle_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`

	// Populated on read (joined) endpoints only.
	ProductName     *string `json:"product_name,omitempty"`
	Category        *string `json:"category,omitempty"`
	ProductImageURL *string `json:"product_image_url,omitempty"`
	// HasOpenFault is true if the asset has any open/in_progress
	// service_records entry — excluded from future allocations regardless
	// of Status; see assetHasOpenFault in service_records.go.
	HasOpenFault bool `json:"has_open_fault"`
	// HomeRackAssetNumber is the home rack's own asset_number, joined in for
	// display (e.g. "Home: Rack R-4") wherever this asset is shown — nil
	// unless HomeRackID is set.
	HomeRackAssetNumber *string `json:"home_rack_asset_number,omitempty"`
}

type Project struct {
	ID     int64   `json:"id"`
	Name   string  `json:"name"`
	Client *string `json:"client,omitempty"`
	// CoreClientID links this project to Core's own Client entity — set
	// once the free-text Client name above has been matched/confirmed or
	// created via the Job Fetch-from-Monday flow (Stage B). No local
	// clients table here (unlike Crewing's Job): Client has only ever been
	// a bare display string, so the link goes straight on Project itself.
	CoreClientID    *string       `json:"core_client_id,omitempty"`
	StartDate       time.Time     `json:"start_date"`
	EndDate         time.Time     `json:"end_date"`
	Status          ProjectStatus `json:"status"`
	CarnetRequired  bool          `json:"carnet_required"`
	ClientReference *string       `json:"client_reference,omitempty"`
	OrderNumber     *string       `json:"order_number,omitempty"`
	DeliveryAddress *string       `json:"delivery_address,omitempty"`
	Notes           *string       `json:"notes,omitempty"`
	// SharedContractID/Name mirror Crewing Job's own fields exactly — an
	// optional, direct link to Core's Contract, plus a cached label from
	// when it was last linked (not live-refreshed - see
	// docs/simplified_suite_core_v0_6.md §5b).
	SharedContractID   *string `json:"shared_contract_id,omitempty"`
	SharedContractName *string `json:"shared_contract_name,omitempty"`
	// SharedJobID links this project to Core's own shared Job entity — set
	// when created from a Monday fetch, whether that fetch found an
	// existing Core Job or created a new one. See migrations/0008
	// (shared_job_link) and Core's own migrations/0008_jobs.sql.
	SharedJobID *string   `json:"shared_job_id,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// BookingRequest is the product-level ask against a project — "we need 2x
// Yellobrik OTT1842 for this job." May start as a placeholder (no
// product_id) and get refined later.
type BookingRequest struct {
	ID                     int64                `json:"id"`
	ProjectID              int64                `json:"project_id"`
	ProductID              *int64               `json:"product_id,omitempty"`
	PlaceholderDescription *string              `json:"placeholder_description,omitempty"`
	QuantityRequested      int                  `json:"quantity_requested"`
	DateOut                time.Time            `json:"date_out"`
	DateIn                 time.Time            `json:"date_in"`
	Status                 BookingRequestStatus `json:"status"`
	ShortageFlag           bool                 `json:"shortage_flag"`
	SubHireNotes           *string              `json:"sub_hire_notes,omitempty"`
	CreatedAt              time.Time            `json:"created_at"`
	UpdatedAt              time.Time            `json:"updated_at"`

	// Populated on read (joined) endpoints only.
	ProductName *string `json:"product_name,omitempty"`
	Category    *string `json:"category,omitempty"`
	ProjectName *string `json:"project_name,omitempty"`
	IsBulk      *bool   `json:"is_bulk,omitempty"`
	// Count of active (allocated/checked_out) allocations against this request.
	AllocatedCount int `json:"allocated_count"`
	// Count of allocations against this request regardless of status —
	// includes 'returned', unlike AllocatedCount. This is the real signal
	// for "has allocation history" (e.g. gating project delete), since a
	// fully-returned request still carries checkout/checkin/damage history.
	TotalAllocationCount int `json:"total_allocation_count"`
}

// BookingAllocation is the specific asset assigned once someone pulls a
// physical unit for a booking_request, plus its checkout/check-in lifecycle.
type BookingAllocation struct {
	ID                    int64                   `json:"id"`
	BookingRequestID      int64                   `json:"booking_request_id"`
	AssetID               int64                   `json:"asset_id"`
	Status                BookingAllocationStatus `json:"status"`
	CheckedOutAt          *time.Time              `json:"checked_out_at,omitempty"`
	CheckedOutBy          *int64                  `json:"checked_out_by,omitempty"`
	InspectionPassed      *bool                   `json:"inspection_passed,omitempty"`
	ConditionOutNotes     *string                 `json:"condition_out_notes,omitempty"`
	CheckedInAt           *time.Time              `json:"checked_in_at,omitempty"`
	CheckedInBy           *int64                  `json:"checked_in_by,omitempty"`
	ConditionInNotes      *string                 `json:"condition_in_notes,omitempty"`
	DamageFlag            bool                    `json:"damage_flag"`
	DamageServiceRecordID *int64                  `json:"damage_service_record_id,omitempty"`
	// ReturnToHomeRack is only meaningful when the asset has a home_rack_id —
	// true means it was pulled individually (not via its own rack's cascade)
	// and should be returned to that rack, surfaced as a check-in reminder.
	ReturnToHomeRack bool      `json:"return_to_home_rack"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`

	// Populated on read (joined) endpoints only.
	AssetNumber      *string `json:"asset_number,omitempty"`
	SerialNumber     *string `json:"serial_number,omitempty"`
	IsBulk           *bool   `json:"is_bulk,omitempty"`
	ProductName      *string `json:"product_name,omitempty"`
	CheckedOutByName *string `json:"checked_out_by_name,omitempty"`
	CheckedInByName  *string `json:"checked_in_by_name,omitempty"`
	// HomeRackID/HomeRackAssetNumber mirror the underlying asset's own
	// fields — included here so the check-in reminder UI doesn't need a
	// second asset lookup. Only meaningful alongside ReturnToHomeRack.
	HomeRackID          *int64  `json:"home_rack_id,omitempty"`
	HomeRackAssetNumber *string `json:"home_rack_asset_number,omitempty"`
	// ContainerType mirrors the allocated asset's own container_type — lets
	// the frontend show rack-member/case-packing UI for this allocation
	// without a second asset lookup.
	ContainerType *ContainerType `json:"container_type,omitempty"`
}

type ServiceRecord struct {
	ID               int64         `json:"id"`
	AssetID          int64         `json:"asset_id"`
	DateReported     time.Time     `json:"date_reported"`
	FaultDescription string        `json:"fault_description"`
	Status           ServiceStatus `json:"status"`
	MondayItemID     *string       `json:"monday_item_id,omitempty"`
	Source           ServiceSource `json:"source"`
	ResolvedDate     *time.Time    `json:"resolved_date,omitempty"`
	ResolutionNotes  *string       `json:"resolution_notes,omitempty"`
	// ReporterUserID is set for an authenticated (staff) submission;
	// ReporterName/ReporterEmail are set for a freelancer submission with
	// no Equiptra account. Exactly one of the two forms is populated.
	ReporterUserID *int64    `json:"reporter_user_id,omitempty"`
	ReporterName   *string   `json:"reporter_name,omitempty"`
	ReporterEmail  *string   `json:"reporter_email,omitempty"`
	ResolvedBy     *int64    `json:"resolved_by,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`

	// Populated on read (joined) endpoints only.
	AssetNumber      *string `json:"asset_number,omitempty"`
	SerialNumber     *string `json:"serial_number,omitempty"`
	ProductID        int64   `json:"product_id"`
	ProductName      *string `json:"product_name,omitempty"`
	ReporterUserName *string `json:"reporter_user_name,omitempty"`
	ResolvedByName   *string `json:"resolved_by_name,omitempty"`
}

// CaseContents is one item packed into a case for a specific job — see
// docs/equiptra-racks-cases-addendum.md. Rows are created at pack-out and
// deleted at check-in.
type CaseContents struct {
	ID                  int64     `json:"id"`
	CaseAssetID         int64     `json:"case_asset_id"`
	ContentAssetID      int64     `json:"content_asset_id"`
	BookingAllocationID int64     `json:"booking_allocation_id"`
	CreatedAt           time.Time `json:"created_at"`

	// Populated on read (joined) endpoints only.
	ContentAssetNumber  *string `json:"content_asset_number,omitempty"`
	ContentSerialNumber *string `json:"content_serial_number,omitempty"`
	ContentProductName  *string `json:"content_product_name,omitempty"`
}

type User struct {
	ID                 int64     `json:"id"`
	Name               string    `json:"name"`
	Email              string    `json:"email"`
	Role               UserRole  `json:"role"`
	Active             bool      `json:"active"`
	MustChangePassword bool      `json:"must_change_password"`
	PasswordHash       string    `json:"-"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}
