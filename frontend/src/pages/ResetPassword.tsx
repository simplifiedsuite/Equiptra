import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'

// Reached only via the emailed link (?token=…) — runs fully logged-out, no
// AuthContext involvement, and on success just points at /login rather
// than establishing a session itself.
export function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      return
    }
    setSubmitting(true)
    try {
      await api.post('/auth/reset-password', { token, new_password: newPassword })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset password')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-off-white px-4">
      <div className="w-full max-w-[360px] rounded-card border border-border bg-surface p-8">
        <div className="mb-1 flex items-center gap-2.5">
          <div className="flex flex-col gap-[3px]">
            <span className="h-[5px] w-[22px] rounded-full bg-teal" />
            <span className="h-[5px] w-[16px] rounded-full bg-teal" />
            <span className="h-[5px] w-[10px] rounded-full bg-teal" />
          </div>
          <div className="text-[17px] font-bold tracking-[.04em] uppercase">Equipment</div>
        </div>
        <p className="mb-6 text-[12px] text-ink-soft">Choose a new password</p>

        {!token ? (
          <div className="text-[13px] leading-relaxed text-red">
            This reset link is missing its token. Request a new one from the{' '}
            <Link to="/forgot-password" className="font-medium text-teal">
              forgot password
            </Link>{' '}
            page.
          </div>
        ) : done ? (
          <>
            <div className="mb-6 text-[13px] leading-relaxed">Your password has been reset.</div>
            <Link
              to="/login"
              className="block w-full rounded-control bg-teal px-4 py-2.5 text-center text-[13px] font-medium text-white hover:opacity-90"
            >
              Sign in
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              New password
              <input
                type="password"
                required
                minLength={8}
                autoFocus
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="rounded-control border border-border px-3.5 py-2.5 text-[13.5px] outline-none focus:border-teal"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Confirm new password
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="rounded-control border border-border px-3.5 py-2.5 text-[13.5px] outline-none focus:border-teal"
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
              {submitting ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
