import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import type { PublicAssetSearchResult } from '../types'

// The one page in this app reachable with no Equiptra account — a freelancer
// reporting a fault on gear they're using has no login to give. Deliberately
// outside <Layout>/RequireAuth (see App.tsx) and talks to the /api/public/*
// routes, which are rate-limited rather than auth-gated (see cmd/api/main.go).
export function ReportFault() {
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PublicAssetSearchResult[]>([])
  const [selected, setSelected] = useState<PublicAssetSearchResult | null>(null)
  const [faultDescription, setFaultDescription] = useState('')
  const [reporterName, setReporterName] = useState('')
  const [reporterEmail, setReporterEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submittedId, setSubmittedId] = useState<number | null>(null)

  useEffect(() => {
    if (!query || selected) {
      setResults([])
      return
    }
    const timeout = setTimeout(() => {
      api
        .get<PublicAssetSearchResult[]>(`/public/assets?search=${encodeURIComponent(query)}`)
        .then(setResults)
        .catch(() => {})
    }, 250)
    return () => clearTimeout(timeout)
  }, [query, selected])

  async function submit() {
    if (!selected) {
      setError('Find and select the asset first')
      return
    }
    if (!faultDescription.trim()) {
      setError('Describe the fault')
      return
    }
    if (!user && (!reporterName.trim() || !reporterEmail.trim())) {
      setError('Your name and email are required')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const record = await api.post<{ id: number }>('/public/fault-reports', {
        asset_id: selected.asset_id,
        fault_description: faultDescription,
        reporter_name: user ? null : reporterName,
        reporter_email: user ? null : reporterEmail,
      })
      setSubmittedId(record.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit report')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-off-white px-4 py-10">
      <div className="w-full max-w-[420px] rounded-card border border-border bg-surface p-8">
        <div className="mb-1 flex items-center gap-2.5">
          <div className="flex flex-col gap-[3px]">
            <span className="h-[5px] w-[22px] rounded-full bg-teal" />
            <span className="h-[5px] w-[16px] rounded-full bg-teal" />
            <span className="h-[5px] w-[10px] rounded-full bg-teal" />
          </div>
          <div className="text-[17px] font-bold tracking-[.04em] uppercase">Equipment</div>
        </div>
        <p className="mb-6 text-[12px] text-ink-soft">Report a fault with a piece of kit.</p>

        {submittedId ? (
          <div className="rounded-control border border-teal-fill bg-teal-fill px-4 py-3.5 text-[13.5px] font-medium text-teal">
            Thanks — your report was logged (#{submittedId}). Someone will follow up.
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Asset
              {selected ? (
                <div className="flex items-center justify-between rounded-control border border-border px-3.5 py-2.5">
                  <span>
                    {selected.asset_number ?? 'bulk'}
                    <span className="ml-1.5 text-ink-soft">· {selected.product_name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null)
                      setQuery('')
                    }}
                    className="text-[12px] font-medium text-teal"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Asset number, serial, or product name…"
                    className="w-full rounded-control border border-border px-3.5 py-2.5 text-[13.5px] outline-none focus:border-teal"
                  />
                  {results.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-control border border-border bg-surface shadow-sm">
                      {results.map((r) => (
                        <button
                          type="button"
                          key={r.asset_id}
                          onClick={() => {
                            setSelected(r)
                            setResults([])
                          }}
                          className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-[13px] hover:bg-off-white"
                        >
                          <span>{r.asset_number ?? 'bulk'}</span>
                          <span className="text-ink-soft">{r.product_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </label>

            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              What's wrong with it?
              <textarea
                value={faultDescription}
                onChange={(e) => setFaultDescription(e.target.value)}
                rows={3}
                placeholder="Describe the fault…"
                className="rounded-control border border-border px-3.5 py-2.5 text-[13.5px] outline-none focus:border-teal"
              />
            </label>

            {user ? (
              <p className="text-[12.5px] text-ink-soft">Reporting as {user.name}.</p>
            ) : (
              <>
                <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                  Your name
                  <input
                    value={reporterName}
                    onChange={(e) => setReporterName(e.target.value)}
                    className="rounded-control border border-border px-3.5 py-2.5 text-[13.5px] outline-none focus:border-teal"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                  Your email
                  <input
                    type="email"
                    value={reporterEmail}
                    onChange={(e) => setReporterEmail(e.target.value)}
                    className="rounded-control border border-border px-3.5 py-2.5 text-[13.5px] outline-none focus:border-teal"
                  />
                </label>
              </>
            )}

            {error && (
              <div className="rounded-control border border-red-fill bg-red-fill px-3.5 py-2.5 text-[13px] font-medium text-red">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="mt-1 rounded-control bg-teal px-4 py-2.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : 'Report fault'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
