import { ChangePasswordForm } from '../components/ChangePasswordForm'
import { useAuth } from '../context/AuthContext'

// Rendered in place of the entire authenticated shell (see App.tsx) whenever
// the logged-in user has must_change_password set — no <Layout>, no nav, no
// route the user could otherwise reach. The backend enforces this too
// (RequirePasswordSet blocks every other /api route for a session in this
// state), so this screen is the real UI, not just a client-side nicety.
export function ForcedPasswordChange() {
  const { logout } = useAuth()

  return (
    <div className="flex min-h-screen items-center justify-center bg-off-white px-4">
      <div className="w-full max-w-[380px] rounded-card border border-border bg-surface p-8">
        <div className="mb-1 flex items-center gap-2.5">
          <div className="flex flex-col gap-[3px]">
            <span className="h-[5px] w-[22px] rounded-full bg-teal" />
            <span className="h-[5px] w-[16px] rounded-full bg-teal" />
            <span className="h-[5px] w-[10px] rounded-full bg-teal" />
          </div>
          <div className="text-[17px] font-bold tracking-[.04em] uppercase">Equipment</div>
        </div>
        <p className="mb-1 text-[13.5px] font-medium">Set a new password</p>
        <p className="mb-6 text-[12px] text-ink-soft">
          An admin reset your password. Set a new one only you know before you can continue.
        </p>

        <ChangePasswordForm submitLabel="Set new password" />

        <button
          onClick={() => void logout()}
          className="mt-4 w-full text-center text-[12px] font-medium text-ink-soft hover:text-ink"
        >
          Log out instead
        </button>
      </div>
    </div>
  )
}
