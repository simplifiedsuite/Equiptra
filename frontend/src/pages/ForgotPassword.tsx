import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'

// Styled to match Login.tsx exactly (same card/brand mark) — reached
// directly off it. Always shows the same confirmation once submitted,
// regardless of whether the email matched an account (see
// RequestPasswordReset's own comment on the backend).
export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
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
        <p className="mb-6 text-[12px] text-ink-soft">Reset your password</p>

        {sent ? (
          <div className="mb-6 text-[13px] leading-relaxed">
            If that email has an account, we've sent a link to reset your password. Check your inbox (and spam folder) — the link expires in 1 hour.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Email
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="mt-5 text-center">
          <Link to="/login" className="text-[12.5px] font-medium text-teal">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
