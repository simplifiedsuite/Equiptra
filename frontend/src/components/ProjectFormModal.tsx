import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../lib/api'
import type { CoreClient, CoreContract, CoreJob, MondayProjectLookup, Project } from '../types'
import { CloseIcon } from './icons'

function toDateInput(iso: string) {
  return iso.slice(0, 10)
}

const fieldClass = 'rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal'
const ghostButtonClass = 'rounded-control border border-border-strong bg-surface px-3.5 py-2 text-[12.5px] font-medium text-teal hover:border-teal disabled:opacity-60'
const primaryButtonClass = 'rounded-control bg-teal px-3.5 py-2 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-60'

// Job Fetch-from-Monday, Stage B — same match/confirm pattern as Crewing's
// own ClientMatchPanel (Stage A), reimplemented natively here since the two
// products don't share a frontend, but calling the exact same Core
// endpoints. Client matching is manual, never automatic: this always waits
// for an explicit confirm/create/pick before calling onResolved. Live from
// Core every time it mounts (keyed by fetchedName at the call site so a
// different Monday fetch starts with a clean slate) — see
// docs/simplified_suite_core_v0_6.md §5a's "pickers always go live" rule.
function ClientMatchPanel({ fetchedName, onResolved }: { fetchedName: string; onResolved: (core: CoreClient) => void }) {
  const [status, setStatus] = useState<'loading' | 'matched' | 'no-match' | 'picking' | 'creating' | 'resolved' | 'error'>('loading')
  const [coreClients, setCoreClients] = useState<CoreClient[]>([])
  const [matched, setMatched] = useState<CoreClient | undefined>(undefined)
  const [pickId, setPickId] = useState('')
  const [newName, setNewName] = useState(fetchedName)
  const [resolved, setResolved] = useState<CoreClient | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<CoreClient[]>('/core-clients')
      .then((list) => {
        if (cancelled) return
        setCoreClients(list)
        const norm = (s: string) => s.trim().toLowerCase()
        const found = list.find((c) => norm(c.name) === norm(fetchedName))
        setMatched(found)
        setStatus(found ? 'matched' : 'no-match')
      })
      .catch(() => {
        if (cancelled) return
        setError('Could not reach Simplified Suite Core to check for a matching client — pick or create one manually below, or leave Client as typed.')
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [fetchedName])

  function confirm(core: CoreClient) {
    setResolved(core)
    setStatus('resolved')
    onResolved(core)
  }

  async function createAndConfirm() {
    if (!newName.trim()) return
    setBusy(true)
    setError(null)
    try {
      const core = await api.post<CoreClient>('/core-clients', { name: newName.trim() })
      confirm(core)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Only an organisation admin can add a new client in Simplified Suite Core — pick an existing one below, or ask your admin to add it.'
          : 'Could not create that client.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-control border border-border p-3">
      <div className="text-[12.5px] font-semibold">Client from Monday: "{fetchedName}"</div>

      {status === 'loading' && <div className="text-[12.5px] text-ink-soft">Checking Simplified Suite for a matching client…</div>}

      {error && <div className="text-[12px] text-red">{error}</div>}

      {status === 'matched' && matched && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px]">
            Matched <strong>{matched.name}</strong> in Simplified Suite.
          </span>
          <button type="button" onClick={() => confirm(matched)} className={primaryButtonClass}>
            Use this client
          </button>
          <button type="button" onClick={() => setStatus('picking')} className={ghostButtonClass}>
            Choose a different client
          </button>
        </div>
      )}

      {status === 'no-match' && (
        <div className="flex flex-col gap-2">
          <div className="text-[12.5px] text-ink-soft">No client named "{fetchedName}" found in Simplified Suite.</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStatus('creating')} className={primaryButtonClass}>
              Create new client
            </button>
            <button type="button" onClick={() => setStatus('picking')} className={ghostButtonClass}>
              Choose an existing client
            </button>
          </div>
        </div>
      )}

      {status === 'creating' && (
        <div className="flex items-center gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} className={`${fieldClass} flex-1`} />
          <button type="button" onClick={createAndConfirm} disabled={busy || !newName.trim()} className={primaryButtonClass}>
            {busy ? 'Creating…' : 'Create & link'}
          </button>
          <button type="button" onClick={() => setStatus(matched ? 'matched' : 'no-match')} className={ghostButtonClass}>
            Cancel
          </button>
        </div>
      )}

      {status === 'picking' && (
        <div className="flex items-center gap-2">
          <select value={pickId} onChange={(e) => setPickId(e.target.value)} className={`${fieldClass} flex-1`}>
            <option value="">Select a client…</option>
            {coreClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const c = coreClients.find((c) => c.id === pickId)
              if (c) confirm(c)
            }}
            disabled={!pickId}
            className={primaryButtonClass}
          >
            Use selected
          </button>
          <button type="button" onClick={() => setStatus(matched ? 'matched' : 'no-match')} className={ghostButtonClass}>
            Cancel
          </button>
        </div>
      )}

      {status === 'resolved' && resolved && (
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="text-teal">✓</span>
          <span>
            Client confirmed: <strong>{resolved.name}</strong>
          </span>
          <button type="button" onClick={() => setStatus(matched ? 'matched' : 'no-match')} className={ghostButtonClass}>
            Change
          </button>
        </div>
      )}
    </div>
  )
}

// The optional "Link to a Contract?" step (Job Fetch-from-Monday, Stage B)
// — always skippable, scoped to whichever Client the project resolves to.
// Live from Core every time coreClientId changes.
function ContractPicker({
  coreClientId,
  value,
  onChange,
}: {
  coreClientId: string
  value?: { id: string; name: string }
  onChange: (contract: { id: string; name: string } | undefined) => void
}) {
  const [contracts, setContracts] = useState<CoreContract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .get<CoreContract[]>(`/core-contracts?client_id=${encodeURIComponent(coreClientId)}`)
      .then((list) => {
        if (!cancelled) {
          setContracts(list)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load contracts from Simplified Suite Core.')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [coreClientId])

  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-medium">
      Link to a Contract? (optional)
      {loading ? (
        <div className="text-[12.5px] font-normal text-ink-soft">Loading this client's contracts…</div>
      ) : error ? (
        <div className="text-[12px] font-normal text-red">{error}</div>
      ) : (
        <select
          value={value?.id ?? ''}
          onChange={(e) => {
            const c = contracts.find((c) => c.id === e.target.value)
            onChange(c ? { id: c.id, name: c.name } : undefined)
          }}
          className={fieldClass}
        >
          <option value="">No contract — standalone project</option>
          {contracts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
    </label>
  )
}

// Shared Core Job entity — one Monday order-number fetch, visible from
// every product (see Core's own migrations/0008_jobs.sql). Shown instead
// of ClientMatchPanel when Core already has this order number: one
// explicit confirm step ("Use this job") before anything is applied —
// order_number matching itself needs no fuzzy logic, but silently
// adopting a found record without showing it first would break the same
// "never auto-apply" rule the Client match already established.
// "Re-check Monday for updates" is the one deliberately separate action
// that actually re-pulls Monday — the default path here never calls
// Monday at all.
function FoundJobPanel({ job, onUse }: { job: CoreJob; onUse: (job: CoreJob) => void }) {
  const [current, setCurrent] = useState(job)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [used, setUsed] = useState(false)

  async function refresh() {
    setRefreshing(true)
    setRefreshError(null)
    try {
      const updated = await api.post<CoreJob>(`/core-jobs/${current.id}/refresh`)
      setCurrent(updated)
    } catch {
      setRefreshError('Could not reach Monday to re-check this job.')
    } finally {
      setRefreshing(false)
    }
  }

  const dateRange = current.date_start ? `${current.date_start}${current.date_end && current.date_end !== current.date_start ? ` – ${current.date_end}` : ''}` : undefined

  return (
    <div className="flex flex-col gap-2 rounded-control border border-border p-3">
      <div className="text-[12.5px] font-semibold">Already in Simplified Suite</div>
      <div className="text-[12.5px]">
        <strong>{current.name}</strong> — {current.client_name}
        {current.contract_name ? ` · ${current.contract_name}` : ''}
        {dateRange ? ` · ${dateRange}` : ''}
      </div>
      {refreshError && <div className="text-[12px] text-red">{refreshError}</div>}
      {used ? (
        <div className="text-[12.5px] text-teal">✓ Applied</div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setUsed(true)
              onUse(current)
            }}
            className={primaryButtonClass}
          >
            Use this job
          </button>
          <button type="button" onClick={refresh} disabled={refreshing} className={ghostButtonClass}>
            {refreshing ? 'Checking…' : 'Re-check Monday for updates'}
          </button>
        </div>
      )}
    </div>
  )
}

export function ProjectFormModal({
  project,
  onClose,
  onSaved,
}: {
  project?: Project
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!project
  const [name, setName] = useState(project?.name ?? '')
  const [client, setClient] = useState(project?.client ?? '')
  const [coreClientId, setCoreClientId] = useState(project?.core_client_id)
  const [startDate, setStartDate] = useState(project ? toDateInput(project.start_date) : '')
  const [endDate, setEndDate] = useState(project ? toDateInput(project.end_date) : '')
  const [carnetRequired, setCarnetRequired] = useState(project?.carnet_required ?? false)
  const [clientReference, setClientReference] = useState(project?.client_reference ?? '')
  const [orderNumber, setOrderNumber] = useState(project?.order_number ?? '')
  const [deliveryAddress, setDeliveryAddress] = useState(project?.delivery_address ?? '')
  const [notes, setNotes] = useState(project?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [mondayError, setMondayError] = useState<string | null>(null)
  const [mondayFetching, setMondayFetching] = useState(false)
  const [mondayClientName, setMondayClientName] = useState<string | undefined>(undefined)
  const [mondayDeliveryAddress, setMondayDeliveryAddress] = useState<string | undefined>(undefined)
  const [sharedContractId, setSharedContractId] = useState(project?.shared_contract_id)
  const [sharedContractName, setSharedContractName] = useState(project?.shared_contract_name)
  // sharedJobId links to Core's shared Job entity — set either by finding
  // an existing one (FoundJobPanel's "Use this job") or, on submit, by
  // creating a new one after a fresh Monday fetch + Client confirm.
  const [sharedJobId, setSharedJobId] = useState(project?.shared_job_id)
  const [foundCoreJob, setFoundCoreJob] = useState<CoreJob | undefined>(undefined)

  // Reusable on edit too, same as Crewing's Stage A. Checks Core first —
  // order_number is a real, exact, unique identifier (Monday's own item
  // name), unlike Client name matching, so this needs no fuzzy logic or
  // confirmation to match. Found: show what was found (FoundJobPanel) and
  // wait for an explicit "Use this job". Not found: fall through to the
  // existing Monday-fetch + Client match/Contract-picker flow, unchanged.
  async function fetchFromMonday() {
    const trimmed = orderNumber.trim()
    if (!trimmed) {
      setMondayError('Enter an order number first.')
      return
    }
    setMondayFetching(true)
    setMondayError(null)
    setFoundCoreJob(undefined)
    setMondayClientName(undefined)
    setMondayDeliveryAddress(undefined)
    // A fresh fetch always needs a fresh match — never silently keep a
    // previous fetch's (or the existing project's) Client/Contract/Job
    // link against new data.
    setCoreClientId(undefined)
    setSharedContractId(undefined)
    setSharedContractName(undefined)
    setSharedJobId(undefined)
    try {
      const existing = await api.get<CoreJob>(`/core-jobs?order_number=${encodeURIComponent(trimmed)}`)
      setFoundCoreJob(existing)
    } catch {
      // 404 (no shared Job yet) or Core's lookup itself failing
      // (unreachable, etc.) both fall through to Monday directly the same
      // way — don't block on Core being reachable, same graceful-
      // degradation rule as everywhere else this flow reads from Core.
      try {
        const result = await api.get<MondayProjectLookup>(`/monday/project-lookup?order_number=${encodeURIComponent(trimmed)}`)
        setName(result.name)
        if (result.start_date) setStartDate(result.start_date)
        if (result.end_date) setEndDate(result.end_date)
        if (result.client_reference) setClientReference(result.client_reference)
        if (result.delivery_address) {
          setDeliveryAddress(result.delivery_address)
          setMondayDeliveryAddress(result.delivery_address)
        }
        if (result.client) {
          setClient(result.client)
          setMondayClientName(result.client)
        }
      } catch (mondayErr) {
        setMondayError(mondayErr instanceof ApiError ? mondayErr.message : 'Could not reach Monday — enter project details manually')
      }
    } finally {
      setMondayFetching(false)
    }
  }

  // "Use this job" — the one explicit confirm step for an already-found
  // shared Job. No separate local mirror needed here (unlike Crewing):
  // Equipment's Client is just a display string + core_client_id, so the
  // Core Client's own id/name apply directly.
  function useFoundJob(job: CoreJob) {
    setName(job.name)
    if (job.date_start) setStartDate(job.date_start)
    if (job.date_end) setEndDate(job.date_end)
    if (job.client_reference) setClientReference(job.client_reference)
    if (job.delivery_address) setDeliveryAddress(job.delivery_address)
    setClient(job.client_name)
    setCoreClientId(job.client_id)
    setSharedContractId(job.contract_id)
    setSharedContractName(job.contract_name)
    setSharedJobId(job.id)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      // If this came from a fresh Monday fetch that found no existing
      // shared Job (coreClientId set via ClientMatchPanel, not via "Use
      // this job"), create the shared Core Job now, right before saving
      // locally — so the next fetch of this order number, from either
      // product, finds it immediately. Non-fatal if it fails (Core
      // unreachable, or a rare race with another fetch of the exact same
      // brand-new order number): still save the local project either way.
      let finalSharedJobId = sharedJobId
      const trimmedOrderNumber = orderNumber.trim()
      if (!finalSharedJobId && coreClientId && trimmedOrderNumber) {
        try {
          const created = await api.post<CoreJob>('/core-jobs', {
            order_number: trimmedOrderNumber,
            name,
            client_id: coreClientId,
            contract_id: sharedContractId,
            date_start: startDate,
            date_end: endDate,
            client_reference: clientReference || undefined,
            delivery_address: mondayDeliveryAddress ?? deliveryAddress ?? undefined,
          })
          finalSharedJobId = created.id
        } catch {
          // See comment above — proceed without a shared Job link.
        }
      }

      const body = {
        name,
        client: client || null,
        core_client_id: coreClientId ?? null,
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
        carnet_required: carnetRequired,
        client_reference: clientReference || null,
        order_number: orderNumber || null,
        delivery_address: deliveryAddress || null,
        notes: notes || null,
        shared_contract_id: sharedContractId ?? null,
        shared_contract_name: sharedContractId ? (sharedContractName ?? null) : null,
        shared_job_id: finalSharedJobId ?? null,
      }
      if (isEdit) {
        await api.put(`/projects/${project.id}`, body)
      } else {
        await api.post('/projects', body)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save project')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,.35)] p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-[440px] overflow-y-auto rounded-card border border-border bg-surface p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-bold">{isEdit ? 'Edit project' : 'New project'}</h2>
          <button type="button" onClick={onClose} className="p-1 text-ink-soft hover:text-ink">
            <CloseIcon className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="flex flex-col gap-3.5">
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
          </label>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium">
              Order number
              <input
                value={orderNumber}
                onChange={(e) => {
                  setOrderNumber(e.target.value)
                  setMondayError(null)
                }}
                placeholder="e.g. 536-244"
                className={fieldClass}
              />
            </label>
            <div className="flex flex-1 flex-col justify-end">
              <button type="button" onClick={fetchFromMonday} disabled={mondayFetching} className={ghostButtonClass}>
                {mondayFetching ? 'Fetching…' : 'Fetch from Monday'}
              </button>
            </div>
          </div>
          {mondayError && (
            <div className="-mt-2 rounded-control border border-red-fill bg-red-fill px-3.5 py-2.5 text-[12.5px] font-medium text-red">
              {mondayError}
            </div>
          )}

          {foundCoreJob && <FoundJobPanel key={foundCoreJob.id} job={foundCoreJob} onUse={useFoundJob} />}

          {mondayClientName && (
            <ClientMatchPanel
              key={mondayClientName}
              fetchedName={mondayClientName}
              onResolved={(core) => {
                setClient(core.name)
                setCoreClientId(core.id)
              }}
            />
          )}

          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Client
            <input
              value={client}
              onChange={(e) => {
                setClient(e.target.value)
                // Typing over the client name manually invalidates whatever
                // Core Client/Contract/Job it was resolved from — never
                // keep a stale link silently pointing at a name that's
                // since been edited.
                setCoreClientId(undefined)
                setSharedContractId(undefined)
                setSharedContractName(undefined)
                setSharedJobId(undefined)
              }}
              className={fieldClass}
            />
          </label>

          {coreClientId && (
            <ContractPicker
              key={coreClientId}
              coreClientId={coreClientId}
              value={sharedContractId ? { id: sharedContractId, name: sharedContractName ?? '' } : undefined}
              onChange={(c) => {
                setSharedContractId(c?.id)
                setSharedContractName(c?.name)
              }}
            />
          )}

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium">
              Start date
              <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldClass} />
            </label>
            <label className="flex flex-1 flex-col gap-1.5 text-[13px] font-medium">
              End date
              <input type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} className={fieldClass} />
            </label>
          </div>

          <div className="mt-1 text-[11px] font-semibold uppercase tracking-[.06em] text-ink-soft">
            For paperwork (carnet / delivery note)
          </div>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Client reference
            <input
              value={clientReference}
              onChange={(e) => setClientReference(e.target.value)}
              placeholder="Their PO/job ref"
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Delivery address
            <textarea
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              rows={3}
              placeholder={'One line per address line'}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={fieldClass} />
          </label>

          <label className="flex items-center gap-2 text-[13px] font-medium">
            <input type="checkbox" checked={carnetRequired} onChange={(e) => setCarnetRequired(e.target.checked)} />
            Carnet required (reminder flag only)
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
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  )
}
