import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../lib/api'
import type { Asset, AssetStatus, ContainerType, CoreVehicle } from '../types'
import { CloseIcon } from './icons'

function toDateInput(iso?: string) {
  return iso ? iso.slice(0, 10) : ''
}

const STATUS_OPTIONS: { value: AssetStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'written_off', label: 'Written off' },
  { value: 'sold', label: 'Sold' },
  { value: 'missing', label: 'Missing' },
]

const CONTAINER_TYPE_OPTIONS: { value: ContainerType | ''; label: string }[] = [
  { value: '', label: 'Not a container' },
  { value: 'rack', label: 'Rack (fixed kit)' },
  { value: 'case', label: 'Case (packed per job)' },
  { value: 'vehicle', label: 'Vehicle (fixed kit)' },
]

export function AssetFormModal({
  productId,
  asset,
  onClose,
  onSaved,
}: {
  productId: number
  asset?: Asset
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!asset
  const [assetNumber, setAssetNumber] = useState(asset?.asset_number ?? '')
  const [serialNumber, setSerialNumber] = useState(asset?.serial_number ?? '')
  const [isBulk, setIsBulk] = useState(asset?.is_bulk ?? false)
  const [quantity, setQuantity] = useState(asset?.quantity ?? 1)
  const [location, setLocation] = useState(asset?.location ?? '')
  const [purchasePrice, setPurchasePrice] = useState(asset?.purchase_price != null ? String(asset.purchase_price) : '')
  const [replacementValue, setReplacementValue] = useState(
    asset?.replacement_value != null ? String(asset.replacement_value) : '',
  )
  const [purchaseDate, setPurchaseDate] = useState(toDateInput(asset?.purchase_date))
  const [status, setStatus] = useState<AssetStatus>(asset?.status ?? 'active')
  const [notes, setNotes] = useState(asset?.notes ?? '')
  const [containerType, setContainerType] = useState<ContainerType | ''>(asset?.container_type ?? '')
  const [homeRackId, setHomeRackId] = useState<number | ''>(asset?.home_rack_id ?? '')
  const [coreVehicleId, setCoreVehicleId] = useState(asset?.core_vehicle_id ?? '')
  const [racks, setRacks] = useState<Asset[]>([])
  const [coreVehicles, setCoreVehicles] = useState<CoreVehicle[]>([])
  const [coreVehiclesError, setCoreVehiclesError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // home_rack_id is edit-only metadata (see the addendum), so this list
  // only matters in edit mode — and an asset can't be a member of a
  // rack/vehicle while also being a container itself, so the field is
  // hidden whenever containerType is set. Racks and vehicles are both
  // valid "fixed to" targets — same home_rack_id mechanism either way.
  useEffect(() => {
    if (!isEdit || containerType) return
    Promise.all([
      api.get<Asset[]>('/assets?container_type=rack&status=active'),
      api.get<Asset[]>('/assets?container_type=vehicle&status=active'),
    ]).then(([racksList, vehiclesList]) => setRacks([...racksList, ...vehiclesList]))
  }, [isEdit, containerType])

  // Live from Core, per the picker rule — the list of vehicles this asset
  // could be, shown only while container_type = vehicle.
  useEffect(() => {
    if (containerType !== 'vehicle') return
    api
      .get<CoreVehicle[]>('/core-vehicles')
      .then(setCoreVehicles)
      .catch((err) => setCoreVehiclesError(err instanceof ApiError ? err.message : 'Could not load vehicles from Simplified Suite Core'))
  }, [containerType])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isBulk && !assetNumber.trim()) {
      setError('Asset number is required for non-bulk units')
      return
    }
    const wasActive = asset?.status !== 'written_off' && asset?.status !== 'sold'
    const goingInactive = status === 'written_off' || status === 'sold'
    if (isEdit && wasActive && goingInactive && status !== asset?.status) {
      const label = STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status
      if (!confirm(`Mark this asset as ${label}? This is a bigger change than a routine correction — it should reflect an actual write-off/disposal.`)) {
        return
      }
    }
    setSubmitting(true)
    try {
      const body = {
        product_id: productId,
        asset_number: isBulk ? null : assetNumber.trim(),
        serial_number: serialNumber.trim() || null,
        is_bulk: isBulk,
        quantity: isBulk ? quantity : 1,
        location: location.trim() || null,
        purchase_price: purchasePrice.trim() === '' ? null : Number(purchasePrice),
        replacement_value: replacementValue.trim() === '' ? null : Number(replacementValue),
        purchase_date: purchaseDate ? new Date(purchaseDate).toISOString() : null,
        status,
        notes: notes.trim() || null,
        container_type: containerType || null,
        home_rack_id: containerType ? null : homeRackId || null,
        core_vehicle_id: containerType === 'vehicle' ? coreVehicleId || null : null,
      }
      if (isEdit) {
        await api.put(`/assets/${asset.id}`, body)
      } else {
        await api.post('/assets', body)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save asset')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,.35)] p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-[460px] overflow-y-auto rounded-card border border-border bg-surface p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-bold">{isEdit ? 'Edit asset' : 'Add asset'}</h2>
          <button type="button" onClick={onClose} className="p-1 text-ink-soft hover:text-ink">
            <CloseIcon className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="flex flex-col gap-3.5">
          <label className="flex items-center gap-2 text-[13px] font-medium">
            <input type="checkbox" checked={isBulk} onChange={(e) => setIsBulk(e.target.checked)} />
            Bulk stock (tracked by quantity, not an individual tag)
          </label>

          {isBulk ? (
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Quantity held
              <input
                type="number"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(0, Number(e.target.value)))}
                className="rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal"
              />
            </label>
          ) : (
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium">
                Asset number
                <input
                  required
                  autoFocus
                  value={assetNumber}
                  onChange={(e) => setAssetNumber(e.target.value)}
                  className="rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium">
                Serial number
                <input
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  className="rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal"
                />
              </label>
            </div>
          )}

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium">
              Location
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Bay/shelf code"
                className="rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AssetStatus)}
                className="rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium">
              Container type
              <select
                value={containerType}
                onChange={(e) => setContainerType(e.target.value as ContainerType | '')}
                className="rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal"
              >
                {CONTAINER_TYPE_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {isEdit && !containerType && (
              <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium">
                Fixed to
                <select
                  value={homeRackId}
                  onChange={(e) => setHomeRackId(e.target.value ? Number(e.target.value) : '')}
                  className="rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal"
                >
                  <option value="">Not fixed to a rack or vehicle</option>
                  {racks
                    .filter((r) => r.id !== asset?.id)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.asset_number} — {r.product_name}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>

          {containerType === 'vehicle' && (
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Which vehicle
              <select
                required
                value={coreVehicleId}
                onChange={(e) => setCoreVehicleId(e.target.value)}
                className="rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal"
              >
                <option value="">Select a vehicle…</option>
                {coreVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} — {v.registration}
                  </option>
                ))}
              </select>
              {coreVehiclesError && <span className="text-[11.5px] font-medium text-red">{coreVehiclesError}</span>}
            </label>
          )}

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium">
              Purchase price (£)
              <input
                type="number"
                step="any"
                min="0"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium">
              Replacement value (£)
              <input
                type="number"
                step="any"
                min="0"
                value={replacementValue}
                onChange={(e) => setReplacementValue(e.target.value)}
                className="rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Purchase date
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal"
            />
          </label>

          {error && (
            <div className="rounded-control border border-red-fill bg-red-fill px-3.5 py-2.5 text-[13px] font-medium text-red">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 rounded-control bg-teal px-4 py-2.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add asset'}
          </button>
        </div>
      </form>
    </div>
  )
}
