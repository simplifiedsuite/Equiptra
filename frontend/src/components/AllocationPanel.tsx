import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type { AllocationWithConflicts, Asset, BookingRequest, CaseContents } from '../types'
import { AssetTag } from './AssetTag'
import { AlertTriangleIcon, CloseIcon, PlusIcon } from './icons'

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const statusLabel: Record<AllocationWithConflicts['status'], string> = {
  allocated: 'Allocated',
  checked_out: 'Checked out',
  returned: 'Returned',
}

const statusClass: Record<AllocationWithConflicts['status'], string> = {
  allocated: 'bg-[#EDEBE4] text-ink-soft',
  checked_out: 'bg-teal-fill text-teal',
  returned: 'bg-[#EDEBE4] text-ink-soft',
}

export function AllocationPanel({ request, onChanged }: { request: BookingRequest; onChanged: () => void }) {
  const [allocations, setAllocations] = useState<AllocationWithConflicts[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reload() {
    setLoading(true)
    api
      .get<AllocationWithConflicts[]>(`/booking-requests/${request.id}/allocations`)
      .then(setAllocations)
      .finally(() => setLoading(false))
  }

  useEffect(reload, [request.id])

  function handleChanged() {
    reload()
    onChanged()
  }

  if (!request.product_id) {
    return (
      <div className="border-t border-border bg-off-white px-5 py-4 text-[13px] text-ink-soft">
        Pin a real product to this request before allocating specific assets.
      </div>
    )
  }

  return (
    <div className="border-t border-border bg-off-white px-5 py-4">
      {request.sub_hire_notes && (
        <div className="mb-3 rounded-control bg-amber-fill px-3.5 py-2.5 text-[12.5px] text-amber">
          <strong>Sub-hire notes:</strong> {request.sub_hire_notes}
        </div>
      )}

      {loading ? (
        <div className="py-2 text-[12.5px] text-ink-soft">Loading…</div>
      ) : (
        <div className="flex flex-col gap-2">
          {allocations.map((a) => (
            <AllocationRow key={a.id} allocation={a} onChanged={handleChanged} />
          ))}
          {allocations.length === 0 && <div className="py-1 text-[12.5px] text-ink-soft">No assets picked yet.</div>}
        </div>
      )}

      {error && <div className="mt-2 text-[12.5px] font-medium text-red">{error}</div>}

      {allocations.length < request.quantity_requested && (
        <button
          onClick={() => setShowAdd(true)}
          className="mt-3 flex items-center gap-1.5 rounded-control border border-border-strong bg-surface px-3.5 py-2 text-[12.5px] font-medium text-teal hover:border-teal"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Allocate an asset
        </button>
      )}

      {showAdd && (
        <AddAllocationForm
          request={request}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false)
            handleChanged()
          }}
          onError={setError}
        />
      )}
    </div>
  )
}

function AllocationRow({ allocation, onChanged }: { allocation: AllocationWithConflicts; onChanged: () => void }) {
  const [showCheckout, setShowCheckout] = useState(false)
  const [showCheckin, setShowCheckin] = useState(false)
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    try {
      await api.delete(`/booking-allocations/${allocation.id}`)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function confirmReturnedToRack() {
    setBusy(true)
    try {
      await api.post(`/booking-allocations/${allocation.id}/return-to-home-rack`)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  // Pulled individually (not via its own rack's cascade — see the backend's
  // return_to_home_rack semantics) and not yet confirmed back in the rack.
  const showReturnToRackReminder = allocation.home_rack_id && allocation.return_to_home_rack

  return (
    <div className={`rounded-control border px-3.5 py-3 ${allocation.conflicts.length > 0 ? 'border-[#E8C5BE] bg-red-fill' : 'border-border bg-surface'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AssetTag number={allocation.asset_number} />
          {allocation.serial_number && <span className="text-[12px] text-ink-soft">{allocation.serial_number}</span>}
          {allocation.home_rack_id && (
            <span className="text-[11.5px] text-ink-soft">Home: Rack {allocation.home_rack_asset_number ?? allocation.home_rack_id}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-[3px] text-[11px] font-semibold ${statusClass[allocation.status]}`}>
            {statusLabel[allocation.status]}
          </span>
          {allocation.status === 'allocated' && (
            <>
              <button
                onClick={() => setShowCheckout(true)}
                className="rounded-control bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
              >
                Check out
              </button>
              <button
                onClick={remove}
                disabled={busy}
                className="rounded-control border border-border px-3 py-1.5 text-[12px] font-medium text-ink-soft hover:bg-off-white"
              >
                Remove
              </button>
            </>
          )}
          {allocation.status === 'checked_out' && (
            <button
              onClick={() => setShowCheckin(true)}
              className="rounded-control bg-ink px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
            >
              Check in
            </button>
          )}
        </div>
      </div>

      {allocation.conflicts.length > 0 && (
        <div className="mt-2 flex items-start gap-2 text-[12px] font-medium text-red">
          <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Already {allocation.conflicts[0].status} on "{allocation.conflicts[0].project_name}" for{' '}
            {formatDate(allocation.conflicts[0].date_out)} – {formatDate(allocation.conflicts[0].date_in)}.
          </span>
        </div>
      )}

      {allocation.status === 'checked_out' && (
        <div className="mt-2 text-[11.5px] text-ink-soft">
          Out since {allocation.checked_out_at && formatDate(allocation.checked_out_at)}
          {allocation.checked_out_by_name ? ` · ${allocation.checked_out_by_name}` : ''}
        </div>
      )}

      {showReturnToRackReminder && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-control border border-amber-fill bg-amber-fill px-3 py-2 text-[12px] text-amber">
          <span>Needs to go back into Rack {allocation.home_rack_asset_number ?? allocation.home_rack_id}.</span>
          <button
            onClick={confirmReturnedToRack}
            disabled={busy}
            className="shrink-0 rounded-control border border-amber px-2.5 py-1 text-[11.5px] font-semibold text-amber hover:bg-white"
          >
            Mark returned
          </button>
        </div>
      )}

      {allocation.container_type && (
        <ContainerContents allocation={allocation} onChanged={onChanged} />
      )}

      {showCheckout && (
        <CheckoutForm
          allocation={allocation}
          onClose={() => setShowCheckout(false)}
          onDone={() => {
            setShowCheckout(false)
            onChanged()
          }}
        />
      )}
      {showCheckin && (
        <CheckinForm allocationId={allocation.id} onClose={() => setShowCheckin(false)} onDone={() => { setShowCheckin(false); onChanged() }} />
      )}
    </div>
  )
}

// ContainerContents shows what's currently in a rack (read-only membership —
// edited via the asset-edit screen's rack swap, admin-only) or a case
// (packed per job — standard users can pack/unpack/swap here, before or
// after checkout).
function ContainerContents({ allocation, onChanged }: { allocation: AllocationWithConflicts; onChanged: () => void }) {
  const { user } = useAuth()
  const [rackMembers, setRackMembers] = useState<Asset[] | null>(null)
  const [caseContents, setCaseContents] = useState<CaseContents[] | null>(null)
  const [showPack, setShowPack] = useState(false)
  const [swapCaseItem, setSwapCaseItem] = useState<number | null>(null)
  const [swapRackAsset, setSwapRackAsset] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reload() {
    if (allocation.container_type === 'rack' || allocation.container_type === 'vehicle') {
      api.get<Asset[]>(`/assets/${allocation.asset_id}/rack-members`).then(setRackMembers)
    } else {
      api.get<CaseContents[]>(`/booking-allocations/${allocation.id}/case-contents`).then(setCaseContents)
    }
  }

  useEffect(reload, [allocation.asset_id, allocation.id, allocation.container_type])

  // Only safe pre-checkout — once checked out, the item has its own
  // cascaded allocation that a plain unpack wouldn't check in, leaving it
  // stuck as checked_out. Post-checkout, use Swap instead (SwapCaseContent
  // checks the old item in and cascades the new one atomically).
  async function unpack(contentAssetId: number) {
    setBusy(true)
    setError(null)
    try {
      await api.delete(`/booking-allocations/${allocation.id}/case-contents/${contentAssetId}`)
      reload()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not unpack item')
    } finally {
      setBusy(false)
    }
  }

  const isCase = allocation.container_type === 'case'
  const isDone = allocation.status === 'returned'
  const isCheckedOut = allocation.status === 'checked_out'

  return (
    <div className="mt-2.5 rounded-control border border-border bg-off-white p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11.5px] font-semibold uppercase tracking-[.04em] text-ink-soft">
          {isCase ? 'Packed contents' : allocation.container_type === 'vehicle' ? 'Vehicle contents' : 'Rack contents'}
        </span>
        {isCase && !isDone && !isCheckedOut && (
          <button onClick={() => setShowPack((s) => !s)} className="text-[11.5px] font-medium text-teal hover:opacity-80">
            {showPack ? 'Close' : 'Pack items'}
          </button>
        )}
      </div>

      {isCase ? (
        <div className="flex flex-col gap-1">
          {caseContents === null ? (
            <span className="text-[12px] text-ink-soft">Loading…</span>
          ) : caseContents.length === 0 ? (
            <span className="text-[12px] text-ink-soft">Nothing packed yet.</span>
          ) : (
            caseContents.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-[12.5px]">
                <span>
                  {c.content_product_name} <AssetTag number={c.content_asset_number} />
                </span>
                {!isDone && (
                  <button
                    onClick={() => (isCheckedOut ? setSwapCaseItem(c.content_asset_id) : unpack(c.content_asset_id))}
                    disabled={busy}
                    className="text-[11.5px] font-medium text-ink-soft hover:text-red"
                  >
                    {isCheckedOut ? 'Swap (fault)' : 'Unpack'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      ) : rackMembers === null ? (
        <span className="text-[12px] text-ink-soft">Loading…</span>
      ) : rackMembers.length === 0 ? (
        <span className="text-[12px] text-ink-soft">No items currently in this {allocation.container_type === 'vehicle' ? 'vehicle' : 'rack'}.</span>
      ) : (
        <div className="flex flex-col gap-1">
          {rackMembers.map((m) => (
            <div key={m.id} className="flex items-center justify-between text-[12.5px]">
              <span>{m.product_name}</span>
              <div className="flex items-center gap-2">
                <AssetTag number={m.asset_number} />
                {user?.role === 'admin' && (
                  <button
                    onClick={() => setSwapRackAsset(m.id)}
                    className="text-[11.5px] font-medium text-ink-soft hover:text-red"
                  >
                    Swap (fault)
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="mt-1.5 text-[11.5px] font-medium text-red">{error}</div>}

      {showPack && (
        <PackCaseForm
          allocation={allocation}
          onClose={() => setShowPack(false)}
          onPacked={() => {
            reload()
            onChanged()
          }}
        />
      )}

      {swapCaseItem != null && (
        <SwapCaseItemForm
          allocation={allocation}
          oldContentAssetId={swapCaseItem}
          onClose={() => setSwapCaseItem(null)}
          onSwapped={() => {
            setSwapCaseItem(null)
            reload()
            onChanged()
          }}
        />
      )}

      {swapRackAsset != null && (
        <SwapRackMemberForm
          rackAssetId={allocation.asset_id}
          oldAssetId={swapRackAsset}
          onClose={() => setSwapRackAsset(null)}
          onSwapped={() => {
            setSwapRackAsset(null)
            reload()
            onChanged()
          }}
        />
      )}
    </div>
  )
}

// SwapCaseItemForm and SwapRackMemberForm are the same underlying operation
// (clear old link, set new link) applied in the two contexts the addendum
// describes — a per-booking case_contents row vs. permanent home_rack_id —
// each hitting its own endpoint with its own access tier (case: standard,
// rack: admin-only).
function SwapCaseItemForm({
  allocation,
  oldContentAssetId,
  onClose,
  onSwapped,
}: {
  allocation: AllocationWithConflicts
  oldContentAssetId: number
  onClose: () => void
  onSwapped: () => void
}) {
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<Asset[]>([])
  const [selected, setSelected] = useState<Asset | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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

  async function submit(override: boolean) {
    if (!selected) return
    setSubmitting(true)
    setWarning(null)
    try {
      await api.post(`/booking-allocations/${allocation.id}/case-contents/swap`, {
        old_content_asset_id: oldContentAssetId,
        new_content_asset_id: selected.id,
        override,
      })
      onSwapped()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { message?: string; conflicts?: { project_name: string }[] }
        setWarning(body.conflicts?.[0] ? `Already committed elsewhere — on "${body.conflicts[0].project_name}".` : body.message || 'Not available.')
      } else {
        setWarning(err instanceof ApiError ? err.message : 'Swap failed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-2 rounded-control border border-border bg-surface p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-semibold">Swap for a replacement</span>
        <button onClick={onClose} className="text-ink-soft hover:text-ink">
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setSelected(null)
          setWarning(null)
        }}
        placeholder="Search replacement by product, asset number, or serial…"
        className="mb-2 w-full rounded-control border border-border px-3 py-2 text-[12.5px] outline-none focus:border-teal"
      />
      {candidates.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {candidates
            .filter((c) => c.id !== oldContentAssetId)
            .map((c) => (
              <button
                key={c.id}
                disabled={c.has_open_fault}
                onClick={() => setSelected(c)}
                className={`rounded-control border px-2.5 py-1.5 text-[12px] font-medium ${
                  c.has_open_fault
                    ? 'cursor-not-allowed border-border bg-red-fill text-red opacity-70'
                    : selected?.id === c.id
                      ? 'border-ink bg-ink text-white'
                      : 'border-border text-ink-soft hover:border-border-strong'
                }`}
              >
                {c.product_name} · {c.is_bulk ? `bulk (${c.quantity} held)` : c.asset_number}
              </button>
            ))}
        </div>
      )}
      {warning && (
        <div className="mb-2 flex flex-col gap-2 rounded-control border border-[#E8C5BE] bg-red-fill px-3 py-2.5 text-[12px] text-red">
          <span>{warning}</span>
          <button
            onClick={() => submit(true)}
            disabled={submitting}
            className="self-start rounded-control border border-red px-3 py-1 text-[11.5px] font-semibold text-red hover:bg-white"
          >
            Swap anyway
          </button>
        </div>
      )}
      <button
        onClick={() => submit(false)}
        disabled={!selected || submitting}
        className="rounded-control bg-teal px-3.5 py-2 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Swapping…' : 'Confirm swap'}
      </button>
    </div>
  )
}

function SwapRackMemberForm({
  rackAssetId,
  oldAssetId,
  onClose,
  onSwapped,
}: {
  rackAssetId: number
  oldAssetId: number
  onClose: () => void
  onSwapped: () => void
}) {
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<Asset[]>([])
  const [selected, setSelected] = useState<Asset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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

  async function submit() {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    try {
      await api.post(`/assets/${rackAssetId}/swap-rack-member`, { old_asset_id: oldAssetId, new_asset_id: selected.id })
      onSwapped()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Swap failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-2 rounded-control border border-border bg-surface p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-semibold">Swap for a replacement</span>
        <button onClick={onClose} className="text-ink-soft hover:text-ink">
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setSelected(null)
        }}
        placeholder="Search replacement by product, asset number, or serial…"
        className="mb-2 w-full rounded-control border border-border px-3 py-2 text-[12.5px] outline-none focus:border-teal"
      />
      {candidates.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {candidates
            .filter((c) => c.id !== oldAssetId)
            .map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className={`rounded-control border px-2.5 py-1.5 text-[12px] font-medium ${
                  selected?.id === c.id ? 'border-ink bg-ink text-white' : 'border-border text-ink-soft hover:border-border-strong'
                }`}
              >
                {c.product_name} · {c.is_bulk ? `bulk (${c.quantity} held)` : c.asset_number}
              </button>
            ))}
        </div>
      )}
      {error && <div className="mb-2 text-[11.5px] font-medium text-red">{error}</div>}
      <button
        onClick={submit}
        disabled={!selected || submitting}
        className="rounded-control bg-teal px-3.5 py-2 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Swapping…' : 'Confirm swap'}
      </button>
    </div>
  )
}

// PackCaseForm packs an item into a case — before checkout this just
// records intent (case_contents); the item's own real allocation is
// created when the case itself is checked out. Reuses the same
// conflict/override pattern as picking a specific asset for a booking.
function PackCaseForm({
  allocation,
  onClose,
  onPacked,
}: {
  allocation: AllocationWithConflicts
  onClose: () => void
  onPacked: () => void
}) {
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<Asset[]>([])
  const [selected, setSelected] = useState<Asset | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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

  async function submit(override: boolean) {
    if (!selected) return
    setSubmitting(true)
    setWarning(null)
    try {
      await api.post(`/booking-allocations/${allocation.id}/case-contents`, { content_asset_id: selected.id, override })
      onPacked()
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { message?: string; conflicts?: { project_name: string }[] }
        if (body.conflicts && body.conflicts.length > 0) {
          setWarning(`Already committed elsewhere — on "${body.conflicts[0].project_name}" for an overlapping date range.`)
        } else {
          setWarning(body.message || 'This would exceed available stock.')
        }
      } else {
        setWarning(err instanceof ApiError ? err.message : 'Could not pack item')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-2 rounded-control border border-border bg-surface p-2.5">
      <input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setSelected(null)
          setWarning(null)
        }}
        placeholder="Search by product, asset number, or serial…"
        className="mb-2 w-full rounded-control border border-border px-3 py-2 text-[12.5px] outline-none focus:border-teal"
      />
      {candidates.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {candidates
            .filter((c) => c.id !== allocation.asset_id)
            .map((c) => (
              <button
                key={c.id}
                disabled={c.has_open_fault}
                title={c.has_open_fault ? 'Excluded — this asset has an open or in-progress fault' : undefined}
                onClick={() => setSelected(c)}
                className={`rounded-control border px-2.5 py-1.5 text-[12px] font-medium ${
                  c.has_open_fault
                    ? 'cursor-not-allowed border-border bg-red-fill text-red opacity-70'
                    : selected?.id === c.id
                      ? 'border-ink bg-ink text-white'
                      : 'border-border text-ink-soft hover:border-border-strong'
                }`}
              >
                {c.product_name} · {c.is_bulk ? `bulk (${c.quantity} held)` : c.asset_number}
              </button>
            ))}
        </div>
      )}

      {warning && (
        <div className="mb-2 flex flex-col gap-2 rounded-control border border-[#E8C5BE] bg-red-fill px-3 py-2.5 text-[12px] text-red">
          <span>{warning}</span>
          <button
            onClick={() => submit(true)}
            disabled={submitting}
            className="self-start rounded-control border border-red px-3 py-1 text-[11.5px] font-semibold text-red hover:bg-white"
          >
            Pack anyway
          </button>
        </div>
      )}

      <button
        onClick={() => submit(false)}
        disabled={!selected || submitting}
        className="rounded-control bg-teal px-3.5 py-2 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Packing…' : 'Pack item'}
      </button>
    </div>
  )
}

function CheckoutForm({
  allocation,
  onClose,
  onDone,
}: {
  allocation: AllocationWithConflicts
  onClose: () => void
  onDone: () => void
}) {
  const [inspectionPassed, setInspectionPassed] = useState(false)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  // blocking=true means checkout hasn't happened yet and needs an explicit
  // override to proceed; blocking=false is a post-success informational
  // note (items skipped as faulted/inactive) with no action to take.
  const [containerNote, setContainerNote] = useState<{
    message: string
    skipped?: { asset_number?: string; reason: string }[]
    blocking: boolean
  } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(override: boolean) {
    setSubmitting(true)
    setError(null)
    setContainerNote(null)
    try {
      const resp = await api.post<{ cascaded_count?: number; skipped?: { asset_number?: string; reason: string }[] }>(
        `/booking-allocations/${allocation.id}/checkout`,
        { inspection_passed: inspectionPassed, condition_out_notes: notes || null, override },
      )
      if (resp.skipped && resp.skipped.length > 0) {
        setContainerNote({
          message: `Checked out. ${resp.skipped.length} item(s) in this ${allocation.container_type} were excluded (not active or faulted) — check them separately.`,
          skipped: resp.skipped,
          blocking: false,
        })
        setTimeout(onDone, 1800)
        return
      }
      onDone()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { message?: string; skipped?: { asset_number?: string; reason: string }[] }
        setContainerNote({ message: body.message ?? 'Some contents are unavailable.', skipped: body.skipped, blocking: true })
      } else {
        setError(err instanceof ApiError ? err.message : 'Checkout failed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-3 rounded-control border border-border bg-off-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-semibold">Pre-release inspection</span>
        <button onClick={onClose} className="text-ink-soft hover:text-ink">
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <label className="mb-2 flex items-center gap-2 text-[12.5px] font-medium">
        <input type="checkbox" checked={inspectionPassed} onChange={(e) => setInspectionPassed(e.target.checked)} />
        Inspection passed — safe and functional to send out
      </label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Condition notes (optional)…"
        rows={2}
        className="mb-2 w-full rounded-control border border-border px-3 py-2 text-[12.5px] outline-none focus:border-teal"
      />
      {!inspectionPassed && (
        <div className="mb-2 text-[11.5px] text-amber">Checkout is blocked until inspection is marked passed.</div>
      )}
      {error && <div className="mb-2 text-[11.5px] font-medium text-red">{error}</div>}
      {containerNote && (
        <div
          className={`mb-2 flex flex-col gap-2 rounded-control border px-3 py-2.5 text-[12px] ${
            containerNote.blocking ? 'border-[#E8C5BE] bg-red-fill text-red' : 'border-amber-fill bg-amber-fill text-amber'
          }`}
        >
          <span>{containerNote.message}</span>
          {containerNote.skipped && containerNote.skipped.length > 0 && (
            <ul className="list-disc pl-4">
              {containerNote.skipped.map((s, i) => (
                <li key={i}>
                  {s.asset_number ?? 'item'} — {s.reason}
                </li>
              ))}
            </ul>
          )}
          {containerNote.blocking && (
            <button
              onClick={() => submit(true)}
              disabled={submitting}
              className="self-start rounded-control border border-red px-3 py-1 text-[11.5px] font-semibold text-red hover:bg-white"
            >
              Check out anyway
            </button>
          )}
        </div>
      )}
      <button
        onClick={() => submit(false)}
        disabled={!inspectionPassed || submitting}
        className="rounded-control bg-teal px-3.5 py-2 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Checking out…' : 'Confirm check out'}
      </button>
    </div>
  )
}

function CheckinForm({ allocationId, onClose, onDone }: { allocationId: number; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState('')
  const [damageFlag, setDamageFlag] = useState(false)
  const [faultDescription, setFaultDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await api.post(`/booking-allocations/${allocationId}/checkin`, {
        condition_in_notes: notes || null,
        damage_flag: damageFlag,
        fault_description: damageFlag ? faultDescription || null : null,
      })
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Check-in failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-3 rounded-control border border-border bg-off-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-semibold">Check in</span>
        <button onClick={onClose} className="text-ink-soft hover:text-ink">
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Condition notes…"
        rows={2}
        className="mb-2 w-full rounded-control border border-border px-3 py-2 text-[12.5px] outline-none focus:border-teal"
      />
      <label className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-red">
        <input type="checkbox" checked={damageFlag} onChange={(e) => setDamageFlag(e.target.checked)} />
        Damaged — log a service record
      </label>
      {damageFlag && (
        <textarea
          value={faultDescription}
          onChange={(e) => setFaultDescription(e.target.value)}
          placeholder="What's wrong with it?"
          rows={2}
          className="mb-2 w-full rounded-control border border-border px-3 py-2 text-[12.5px] outline-none focus:border-teal"
        />
      )}
      {error && <div className="mb-2 text-[11.5px] font-medium text-red">{error}</div>}
      <button
        onClick={submit}
        disabled={submitting}
        className="rounded-control bg-ink px-3.5 py-2 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Checking in…' : 'Confirm check in'}
      </button>
    </div>
  )
}

function AddAllocationForm({
  request,
  onClose,
  onAdded,
  onError,
}: {
  request: BookingRequest
  onClose: () => void
  onAdded: () => void
  onError: (msg: string | null) => void
}) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [selected, setSelected] = useState<Asset | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    api.get<Asset[]>(`/assets?product_id=${request.product_id}&status=active`).then(setAssets)
  }, [request.product_id])

  async function submit(override: boolean) {
    if (!selected) return
    setSubmitting(true)
    onError(null)
    setWarning(null)
    try {
      await api.post(`/booking-requests/${request.id}/allocations`, { asset_id: selected.id, override })
      onAdded()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { message?: string; error?: string; conflicts?: { project_name: string }[] }
        if (body.conflicts && body.conflicts.length > 0) {
          setWarning(`Already committed elsewhere — on "${body.conflicts[0].project_name}" for an overlapping date range.`)
        } else {
          setWarning(body.message || 'This would exceed available stock.')
        }
      } else {
        onError(err instanceof ApiError ? err.message : 'Could not allocate asset')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-3 rounded-control border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12.5px] font-semibold">Pick a specific asset</span>
        <button onClick={onClose} className="text-ink-soft hover:text-ink">
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {assets.map((a) => (
          <button
            key={a.id}
            disabled={a.has_open_fault}
            title={a.has_open_fault ? 'Excluded — this asset has an open or in-progress fault' : undefined}
            onClick={() => {
              setSelected(a)
              setWarning(null)
            }}
            className={`rounded-control border px-2.5 py-1.5 text-[12px] font-medium ${
              a.has_open_fault
                ? 'cursor-not-allowed border-border bg-red-fill text-red opacity-70'
                : selected?.id === a.id
                  ? 'border-ink bg-ink text-white'
                  : 'border-border text-ink-soft hover:border-border-strong'
            }`}
          >
            {a.is_bulk ? `bulk (${a.quantity} held)` : a.asset_number}
            {a.has_open_fault ? ' · faulted' : ''}
            {a.home_rack_id ? ` · home: R-${a.home_rack_asset_number ?? a.home_rack_id}` : ''}
          </button>
        ))}
        {assets.length === 0 && <span className="text-[12px] text-ink-soft">No active assets found for this product.</span>}
      </div>

      {warning && (
        <div className="mt-2 flex flex-col gap-2 rounded-control border border-[#E8C5BE] bg-red-fill px-3 py-2.5 text-[12px] text-red">
          <span>{warning}</span>
          <button
            onClick={() => submit(true)}
            disabled={submitting}
            className="self-start rounded-control border border-red px-3 py-1 text-[11.5px] font-semibold text-red hover:bg-white"
          >
            Allocate anyway
          </button>
        </div>
      )}

      <button
        onClick={() => submit(false)}
        disabled={!selected || submitting}
        className="mt-2.5 rounded-control bg-teal px-3.5 py-2 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Allocating…' : 'Allocate'}
      </button>
    </div>
  )
}
