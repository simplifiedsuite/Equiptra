import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChangePasswordForm } from '../components/ChangePasswordForm'

export function Settings() {
  const [justChanged, setJustChanged] = useState(false)

  return (
    <div>
      <div className="mb-5.5">
        <h1 className="text-[21px] font-bold">Settings</h1>
        <p className="mt-1 text-[13px] text-ink-soft">Your account</p>
      </div>

      <div className="max-w-[400px] rounded-card border border-border bg-surface p-6">
        <h2 className="mb-4 text-[15px] font-bold">Change password</h2>

        {justChanged && (
          <div className="mb-3.5 rounded-control border border-teal-fill bg-teal-fill px-3.5 py-2.5 text-[13px] font-medium text-teal">
            Password updated.
          </div>
        )}

        <ChangePasswordForm onSuccess={() => setJustChanged(true)} />
      </div>

      <div className="mt-5 max-w-[400px] rounded-card border border-border bg-surface p-6">
        <h2 className="mb-1.5 text-[15px] font-bold">Contract defaults</h2>
        <p className="mb-4 text-[13px] text-ink-soft">Starting-point kit templates applied to a new Project created under a Contract.</p>
        <Link to="/contract-defaults" className="text-[13px] font-medium text-teal hover:opacity-80">
          Manage Contract defaults →
        </Link>
      </div>
    </div>
  )
}
