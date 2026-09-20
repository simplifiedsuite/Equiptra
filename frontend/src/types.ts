export type AssetStatus = 'active' | 'written_off' | 'sold' | 'missing'
export type ContainerType = 'rack' | 'case' | 'vehicle'
export type ProjectStatus = 'tentative' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
export type BookingRequestStatus = 'draft' | 'reserved' | 'partially_allocated' | 'out' | 'returned' | 'cancelled'
export type BookingAllocationStatus = 'allocated' | 'checked_out' | 'returned'
export type ServiceStatus = 'open' | 'under_investigation' | 'in_progress' | 'resolved'
export type ServiceSource = 'monday_report' | 'checkin_damage' | 'field_report'
export type UserRole = 'admin' | 'standard'

export interface Product {
  id: number
  legacy_id?: number
  name: string
  category?: string
  manufacturer?: string
  weight_kg?: number
  country_of_origin_code?: string
  is_accessory: boolean
  barcode?: string
  image_url?: string
  description?: string
  active: boolean
  created_at: string
  updated_at: string
}

export interface Asset {
  id: number
  legacy_id?: number
  product_id: number
  asset_number?: string
  serial_number?: string
  is_bulk: boolean
  quantity: number
  location?: string
  purchase_price?: number
  replacement_value?: number
  purchase_date?: string
  status: AssetStatus
  notes?: string
  container_type?: ContainerType
  home_rack_id?: number
  // core_vehicle_id links this asset to Core's shared Vehicle entity when
  // container_type is "vehicle" — see migrations/0010_vehicle_kit_tracking.sql.
  core_vehicle_id?: string
  created_at: string
  updated_at: string
  product_name?: string
  category?: string
  product_image_url?: string
  has_open_fault: boolean
  home_rack_asset_number?: string
}

export interface ProductListItem extends Product {
  total_units: number
  available_units: number
}

export interface CurrentAllocationInfo {
  allocation_id: number
  project_name: string
  date_out: string
  date_in: string
  status: string
}

export interface ProductAssetItem extends Asset {
  current_allocations: CurrentAllocationInfo[]
}

export interface Project {
  id: number
  name: string
  client?: string
  // core_client_id links this project to Core's own Client entity — set
  // once `client`'s name has been matched/confirmed or created via the
  // Job Fetch-from-Monday flow (Stage B). No local clients table here
  // (unlike Crewing's Job), so the link lives directly on Project.
  core_client_id?: string
  start_date: string
  end_date: string
  status: ProjectStatus
  carnet_required: boolean
  client_reference?: string
  order_number?: string
  delivery_address?: string
  notes?: string
  // shared_contract_id/name: an optional, direct link to Core's Contract,
  // plus a cached label from when it was last linked (not live-refreshed).
  // Mirrors Crewing Job's own fields exactly.
  shared_contract_id?: string
  shared_contract_name?: string
  // shared_job_id links this project to Core's own shared Job entity —
  // set when created from a Monday fetch, whether that fetch found an
  // existing Core Job (created earlier, by either product) or created a
  // new one. See Core's own migrations/0008_jobs.sql.
  shared_job_id?: string
  created_at: string
  updated_at: string
}

export interface MondayProjectLookup {
  name: string
  client?: string
  start_date?: string
  end_date?: string
  client_reference?: string
  delivery_address?: string
}

// The subset of Core's own Client shape the Monday-fetch flow reads —
// fetched live from Core (GET /core-clients, proxied), never cached, per
// docs/simplified_suite_core_v0_6.md §5a's "pickers always go live" rule.
export interface CoreClient {
  id: string
  name: string
  website?: string
  brand_color_hex?: string
}

// The subset of Core's own Contract shape the "Link to a Contract?" picker
// reads — also fetched live (GET /core-contracts?client_id=...).
export interface CoreContract {
  id: string
  client_id: string
  client_name: string
  name: string
  date_start?: string
  date_end?: string
}

// Core's own shared Vehicle entity — identity only (registration,
// name/label). Fetched live (GET /core-vehicles) for the asset-edit
// screen's "which vehicle is this?" picker when container_type = vehicle.
export interface CoreVehicle {
  id: string
  name: string
  registration: string
}

// Core's own shared Job entity — one Monday order-number fetch, visible
// from every product (see Core's migrations/0008_jobs.sql). client_name/
// contract_name are joined in for display.
export interface CoreJob {
  id: string
  order_number: string
  name: string
  client_id: string
  client_name: string
  contract_id?: string
  contract_name?: string
  date_start?: string
  date_end?: string
  client_reference?: string
  delivery_address?: string
}

export interface ProjectStatusConflictAsset {
  asset_id: number
  asset_number?: string
  product_name: string
  allocation_status: BookingAllocationStatus
}

export interface BookingRequest {
  id: number
  project_id: number
  product_id?: number
  placeholder_description?: string
  quantity_requested: number
  date_out: string
  date_in: string
  status: BookingRequestStatus
  shortage_flag: boolean
  sub_hire_notes?: string
  created_at: string
  updated_at: string
  product_name?: string
  category?: string
  project_name?: string
  is_bulk?: boolean
  allocated_count: number
  total_allocation_count: number
}

export interface BookingAllocation {
  id: number
  booking_request_id: number
  asset_id: number
  status: BookingAllocationStatus
  checked_out_at?: string
  checked_out_by?: number
  inspection_passed?: boolean
  condition_out_notes?: string
  checked_in_at?: string
  checked_in_by?: number
  condition_in_notes?: string
  damage_flag: boolean
  damage_service_record_id?: number
  return_to_home_rack: boolean
  created_at: string
  updated_at: string
  asset_number?: string
  serial_number?: string
  is_bulk?: boolean
  product_name?: string
  checked_out_by_name?: string
  checked_in_by_name?: string
  home_rack_id?: number
  home_rack_asset_number?: string
  container_type?: ContainerType
}

export interface CaseContents {
  id: number
  case_asset_id: number
  content_asset_id: number
  booking_allocation_id: number
  created_at: string
  content_asset_number?: string
  content_serial_number?: string
  content_product_name?: string
}

export interface AllocationConflict {
  allocation_id: number
  booking_request_id: number
  project_name: string
  date_out: string
  date_in: string
  status: string
}

export interface AllocationWithConflicts extends BookingAllocation {
  conflicts: AllocationConflict[]
}

export interface ServiceRecord {
  id: number
  asset_id: number
  date_reported: string
  fault_description: string
  status: ServiceStatus
  monday_item_id?: string
  source: ServiceSource
  resolved_date?: string
  resolution_notes?: string
  reporter_user_id?: number
  reporter_name?: string
  reporter_email?: string
  resolved_by?: number
  created_at: string
  updated_at: string
  asset_number?: string
  serial_number?: string
  product_id: number
  product_name?: string
  reporter_user_name?: string
  resolved_by_name?: string
}

export interface PublicAssetSearchResult {
  asset_id: number
  asset_number?: string
  serial_number?: string
  product_name: string
  category?: string
}

export interface CarnetLine {
  product_id: number
  description: string
  quantity: number
  total_weight_kg: number
  total_value: number
  country_of_origin_code?: string
  missing_origin: boolean
}

export interface CarnetView {
  project_id: number
  project_name: string
  lines: CarnetLine[]
  total_weight_kg: number
  total_value: number
  missing_origin: boolean
}

export interface DeliveryNoteLine {
  description: string
  quantity: number
  asset_number?: string
  serial_number?: string
  is_accessory: boolean
}

export interface DeliveryNoteView {
  project: Project
  lines: DeliveryNoteLine[]
  total_weight_kg: number
  total_value: number
}

export interface CurrentUser {
  id: number
  name: string
  email: string
  role: UserRole
  must_change_password: boolean
}

export interface User {
  id: number
  name: string
  email: string
  role: UserRole
  active: boolean
  must_change_password: boolean
  created_at: string
  updated_at: string
  has_allocation_history: boolean
}
