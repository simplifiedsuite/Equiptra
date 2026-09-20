import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, ApiError } from '../context/AuthContext'

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      navigate('/products')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in')
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
        <p className="mb-6 text-[12px] text-ink-soft">Equipment management, simplified.</p>

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
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-control border border-border px-3.5 py-2.5 text-[13.5px] outline-none focus:border-teal"
            />
          </label>
          <div className="-mt-2 text-right">
            <Link to="/forgot-password" className="text-[12.5px] font-medium text-teal">
              Forgot password?
            </Link>
          </div>

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
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
