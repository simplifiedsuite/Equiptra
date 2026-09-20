import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type { Asset, BookingAllocation, CaseContents, Product, ServiceRecord } from '../types'
import { AssetTag } from './AssetTag'
import { ProductThumbnail } from './ProductThumbnail'
import { ScanButton } from './ScanButton'
import { CloseIcon, UploadIcon } from './icons'

const containerTypeLabel: Record<NonNullable<Asset['container_type']>, string> = {
  rack: 'Rack',
  case: 'Case',
  vehicle: 'Vehicle',
}

const statusLabel: Record<Asset['status'], string> = {
  active: 'Active',
  written_off: 'Written off',
  sold: 'Sold',
  missing: 'Missing',
}

const statusBadgeClass: Record<Asset['status'], string> = {
  active: 'bg-teal-fill text-teal',
  written_off: 'bg-[#EDEBE4] text-ink-soft',
  sold: 'bg-[#EDEBE4] text-ink-soft',
  missing: 'bg-red-fill text-red',
}

const allocationStatusLabel: Record<BookingAllocation['status'], string> = {
  allocated: 'Allocated',
  checked_out: 'Checked out',
  returned: 'Returned',
}

interface HistoryAllocation extends BookingAllocation {
  project_name: string
  date_out: string
  date_in: string
}

function formatDate(d?: string) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function AssetDetailPanel({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { user } = useAuth()
  const [allocations, setAllocations] = useState<HistoryAllocation[]>([])
  const [serviceRecords, setServiceRecords] = useState<ServiceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [photoUrl, setPhotoUrl] = useState(asset.product_image_url)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [rackMembers, setRackMembers] = useState<Asset[] | null>(null)
  const [caseContents, setCaseContents] = useState<CaseContents[] | null>(null)
  const [showAddToRack, setShowAddToRack] = useState(false)
  const [rackError, setRackError] = useState<string | null>(null)

  async function handlePhotoSelected(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      const product = await api.uploadFile<Product>(`/products/${asset.product_id}/photo`, 'photo', file)
      setPhotoUrl(product.image_url)
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<{ allocations: HistoryAllocation[]; service_records: ServiceRecord[] }>(`/assets/${asset.id}/history`)
      .then((data) => {
        if (cancelled) return
        setAllocations(data.allocations)
        setServiceRecords(data.service_records)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [asset.id])

  function reloadRackMembers() {
    if (asset.container_type === 'rack' || asset.container_type === 'vehicle') {
      api.get<Asset[]>(`/assets/${asset.id}/rack-members`).then(setRackMembers)
    }
  }
  useEffect(reloadRackMembers, [asset.id, asset.container_type])

  async function removeFromRack(memberAssetId: number) {
    setRackError(null)
    try {
      await api.delete(`/assets/${asset.id}/members/${memberAssetId}`)
      reloadRackMembers()
    } catch (err) {
      setRackError(err instanceof ApiError ? err.message : 'Could not remove item')
    }
  }

  // A case has no contents between jobs — only fetch if there's a currently
  // active (allocated/checked_out) allocation for it to be packed against.
  useEffect(() => {
    if (asset.container_type !== 'case') return
    const active = allocations.find((a) => a.status === 'allocated' || a.status === 'checked_out')
    if (!active) {
      setCaseContents([])
      return
    }
    api.get<CaseContents[]>(`/booking-allocations/${active.id}/case-contents`).then(setCaseContents)
  }, [asset.id, asset.container_type, allocations])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(15,23,42,.35)]" onClick={onClose}>
      <div
        className="h-full w-full max-w-[92vw] overflow-y-auto border-l border-border bg-surface px-6.5 pb-7.5 pt-6.5 sm:w-[380px]"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="float-right p-1 text-ink-soft hover:text-ink">
          <CloseIcon className="h-4.5 w-4.5" />
        </button>
        <div className="mb-3.5 flex items-start gap-3.5">
          <ProductThumbnail url={photoUrl} size="panel" />
          <div className="flex-1">
            <h2 className="mb-0.5 text-[18px] font-bold">{asset.product_name}</h2>
            <div className="mb-2 text-[12.5px] text-ink-soft">
              {asset.category}
              {asset.serial_number ? ` · ${asset.serial_number}` : ''}
            </div>
            {user?.role === 'admin' && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handlePhotoSelected(file)
                    e.target.value = ''
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 rounded-control border border-border px-2.5 py-1.5 text-[11.5px] font-medium text-ink-soft hover:border-teal hover:text-teal disabled:opacity-60"
                >
                  <UploadIcon className="h-3.5 w-3.5" />
                  {uploading ? 'Uploading…' : photoUrl ? 'Replace photo' : 'Upload photo'}
                </button>
                {uploadError && <div className="mt-1 text-[11.5px] font-medium text-red">{uploadError}</div>}
              </>
            )}
          </div>
        </div>

        <div className="mb-1">
          <AssetTag number={asset.asset_number} />
        </div>

        <Row label="Serial number" value={asset.serial_number ?? '—'} />
        <Row label="Location" value={asset.location ?? '—'} />
        <Row
          label="Status"
          value={
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusBadgeClass[asset.status]}`}>
              {statusLabel[asset.status]}
            </span>
          }
        />
        {asset.is_bulk && <Row label="Quantity held" value={String(asset.quantity)} />}
        {asset.container_type && <Row label="Container" value={containerTypeLabel[asset.container_type]} />}
        {asset.home_rack_id && <Row label="Fixed to" value={asset.home_rack_asset_number ?? String(asset.home_rack_id)} />}
        <Row label="Replacement value" value={asset.replacement_value != null ? `£${asset.replacement_value.toLocaleString()}` : '—'} />
        <Row label="Purchase price" value={asset.purchase_price != null ? `£${asset.purchase_price.toLocaleString()}` : '—'} />
        <Row label="Purchase date" value={formatDate(asset.purchase_date) || '—'} />

        {(asset.container_type === 'rack' || asset.container_type === 'vehicle') && (
          <>
            <div className="mb-2.5 mt-5.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-ink-soft">
                {containerTypeLabel[asset.container_type]} contents
              </span>
              {user?.role === 'admin' && (
                <button
                  onClick={() => setShowAddToRack((s) => !s)}
                  className="text-[11.5px] font-medium text-teal hover:opacity-80"
                >
                  {showAddToRack ? 'Close' : `Add to ${asset.container_type}`}
                </button>
              )}
            </div>
            {showAddToRack && (
              <AddToRackPanel
                rackId={asset.id}
                onAdded={reloadRackMembers}
              />
            )}
            {rackMembers === null ? (
              <div className="py-2 text-[12.5px] text-ink-soft">Loading…</div>
            ) : rackMembers.length ? (
              rackMembers.map((m) => (
                <div key={m.id} className="flex items-center justify-between border-b border-border py-2.25 text-[13px]">
                  <span className="font-medium">{m.product_name}</span>
                  <div className="flex items-center gap-2">
                    <AssetTag number={m.asset_number} />
                    {user?.role === 'admin' && (
                      <button
                        onClick={() => removeFromRack(m.id)}
                        className="text-[11.5px] font-medium text-ink-soft hover:text-red"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="border-b border-border py-2.5 text-[12.5px] text-ink-soft">No items currently in this {asset.container_type}</div>
            )}
            {rackError && <div className="border-b border-border py-2 text-[11.5px] font-medium text-red">{rackError}</div>}
          </>
        )}

        {asset.container_type === 'case' && (
          <>
            <div className="mb-2.5 mt-5.5 text-[11px] font-semibold uppercase tracking-[.06em] text-ink-soft">
              Case contents
            </div>
            {caseContents === null ? (
              <div className="py-2 text-[12.5px] text-ink-soft">Loading…</div>
            ) : caseContents.length ? (
              caseContents.map((c) => (
                <div key={c.id} className="flex items-center justify-between border-b border-border py-2.25 text-[13px]">
                  <span className="font-medium">{c.content_product_name}</span>
                  <AssetTag number={c.content_asset_number} />
                </div>
              ))
            ) : (
              <div className="border-b border-border py-2.5 text-[12.5px] text-ink-soft">
                Empty between bookings — packed at pack-out for its next job
              </div>
            )}
          </>
        )}

        <div className="mb-2.5 mt-5.5 text-[11px] font-semibold uppercase tracking-[.06em] text-ink-soft">
          Booking history
        </div>
        {loading ? (
          <div className="py-2 text-[12.5px] text-ink-soft">Loading…</div>
        ) : allocations.length ? (
          allocations.map((a) => (
            <div key={a.id} className="border-b border-border py-2.5 text-[12.5px]">
              <div className="flex justify-between">
                <span className="font-medium">{a.project_name}</span>
                <span className="text-ink-soft">
                  {formatDate(a.date_out)} – {formatDate(a.date_in)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-ink-soft">
                <span>{allocationStatusLabel[a.status]}</span>
                {a.damage_flag && <span className="font-semibold text-red">Damage reported</span>}
              </div>
            </div>
          ))
        ) : (
          <div className="border-b border-border py-2.5 text-[12.5px] text-ink-soft">No bookings on record</div>
        )}

        <div className="mb-2.5 mt-5.5 text-[11px] font-semibold uppercase tracking-[.06em] text-ink-soft">
          Service records
        </div>
        {loading ? (
          <div className="py-2 text-[12.5px] text-ink-soft">Loading…</div>
        ) : serviceRecords.length ? (
          serviceRecords.map((s) => (
            <div key={s.id} className="flex justify-between border-b border-border py-2.5 text-[12.5px]">
              <span className="font-medium">{s.fault_description}</span>
              <span className="text-ink-soft">{formatDate(s.date_reported)}</span>
            </div>
          ))
        ) : (
          <div className="border-b border-border py-2.5 text-[12.5px] text-ink-soft">No faults logged</div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2.25 text-[13px]">
      <span className="text-ink-soft">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

// AddToRackPanel is the rack-centric counterpart to AllocationPanel's case
// "Pack items" flow — but not booking-scoped (rack membership is permanent
// kit structure, not per-job), and scan-first rather than search-first,
// since building a rack physically means scanning items onto it one at a
// time. Every successful scan or search-select adds immediately and resets
// to a ready-to-scan-again state — no per-item confirm step, matching the
// "scan, it's added, scan the next one" loop of actually building a rack by
// hand. Reuses ScanButton (the same decoder Products.tsx's search uses)
// rather than reimplementing barcode decoding here.
function AddToRackPanel({ rackId, onAdded }: { rackId: number; onAdded: () => void }) {
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<Asset[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (search.trim().length < 2) {
      setCandidates([])
      return
    }
    const t = setTimeout(() => {
      api.get<Asset[]>(`/assets?search=${encodeURIComponent(search.trim())}&status=active`).then(setCandidates)
    }, 200)
    return () => clearTimeout(t)
  }, [search])

  async function addAsset(assetId: number, label: string) {
    setBusy(true)
    setMessage(null)
    try {
      await api.post(`/assets/${rackId}/members`, { asset_id: assetId })
      setMessage({ type: 'success', text: `Added ${label} — ready to scan the next one.` })
      setSearch('')
      setCandidates([])
      onAdded()
      searchInputRef.current?.focus()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof ApiError ? err.message : 'Could not add item' })
    } finally {
      setBusy(false)
    }
  }

  async function handleScanned(text: string) {
    setBusy(true)
    setMessage(null)
    try {
      const matches = await api.get<Asset[]>(`/assets?search=${encodeURIComponent(text)}&status=active`)
      const exact = matches.find(
        (a) => a.asset_number?.toLowerCase() === text.toLowerCase() || a.serial_number?.toLowerCase() === text.toLowerCase(),
      )
      if (!exact) {
        setMessage({ type: 'error', text: `No active asset found matching "${text}" — ready to scan again.` })
        return
      }
      await addAsset(exact.id, exact.asset_number ?? text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-3 rounded-control border border-border bg-off-white p-2.5">
      <div className="mb-2 flex gap-2">
        <input
          ref={searchInputRef}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setMessage(null)
          }}
          placeholder="Search by product, asset number, or serial…"
          className="min-w-0 flex-1 rounded-control border border-border px-3 py-2 text-[12.5px] outline-none focus:border-teal"
        />
        <ScanButton
          onScanned={handleScanned}
          onError={(text) => setMessage({ type: 'error', text })}
          label="Scan"
          className="shrink-0 flex items-center gap-1.5 rounded-control bg-ink px-3 py-2 text-[12px] font-medium text-white hover:opacity-88 disabled:opacity-60"
        />
      </div>
      {candidates.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {candidates
            .filter((c) => c.id !== rackId)
            .map((c) => (
              <button
                key={c.id}
                disabled={busy}
                onClick={() => addAsset(c.id, c.asset_number ?? c.product_name ?? 'item')}
                className="rounded-control border border-border px-2.5 py-1.5 text-[12px] font-medium text-ink-soft hover:border-border-strong disabled:opacity-50"
              >
                {c.product_name} · {c.is_bulk ? `bulk (${c.quantity} held)` : c.asset_number}
              </button>
            ))}
        </div>
      )}
      {message && (
        <div className={`text-[11.5px] font-medium ${message.type === 'error' ? 'text-red' : 'text-teal'}`}>{message.text}</div>
      )}
    </div>
  )
}
