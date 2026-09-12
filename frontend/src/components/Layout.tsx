import { NavLink, Outlet } from 'react-router-dom'
import { GridIcon, FolderIcon, FileIcon, UsersIcon, WrenchIcon, SettingsIcon, LogOutIcon } from './icons'
import { useAuth } from '../context/AuthContext'

const navItems = [
  { to: '/products', label: 'Products', icon: GridIcon },
  { to: '/projects', label: 'Projects', icon: FolderIcon },
  { to: '/services', label: 'Services', icon: WrenchIcon },
  { to: '/carnets', label: 'Carnets', icon: FileIcon },
  { to: '/delivery-notes', label: 'Delivery notes', icon: FileIcon },
]

export function Layout() {
  const { user, logout } = useAuth()
  const items = user?.role === 'admin' ? [...navItems, { to: '/users', label: 'Users', icon: UsersIcon }] : navItems

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-border bg-surface p-2.5 md:w-[200px] md:flex-col md:overflow-visible md:border-b-0 md:border-r md:py-5">
        {/* Real navigation (not a client-side route) back to Simplified
            Suite's own Landing screen — matches Crewing's wordmark, which
            links out the same way via window.location. */}
        <a
          href="https://simplifiedsuite.io"
          title="Open Simplified Suite"
          className="mb-3 hidden border-b border-border px-5 pb-4.5 text-inherit no-underline md:block"
        >
          <div className="mb-2 flex items-center gap-2.5">
            <div className="flex flex-col gap-[3px]">
              <span className="h-[5px] w-[22px] rounded-full bg-teal" />
              <span className="h-[5px] w-[16px] rounded-full bg-teal" />
              <span className="h-[5px] w-[10px] rounded-full bg-teal" />
            </div>
            <div className="text-[16px] font-bold tracking-[.04em] uppercase">Equiptra</div>
          </div>
          <span className="text-[11px] text-ink-soft">Equipment management, simplified.</span>
        </a>

        {items.map(({ to, label, icon: ItemIcon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-2.5 whitespace-nowrap px-3 py-2 text-[13.5px] font-medium md:border-l-[3px] md:px-5 md:py-2.5 ${
                isActive
                  ? 'border-b-[3px] border-teal text-teal md:border-b-0 md:bg-teal-fill'
                  : 'border-b-[3px] border-transparent text-ink-soft hover:bg-off-white md:border-l-transparent'
              }`
            }
          >
            <ItemIcon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}

        <div className="hidden flex-1 md:block" />

        <div className="hidden items-center justify-between border-t border-border px-5 pt-4 md:flex">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">{user?.name}</div>
            <div className="truncate text-[11px] text-ink-soft">{user?.role}</div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <NavLink
              to="/settings"
              className="rounded-lg p-1.5 text-ink-soft hover:bg-off-white hover:text-ink"
              title="Settings"
            >
              <SettingsIcon className="h-4 w-4" />
            </NavLink>
            <button
              onClick={() => void logout()}
              className="rounded-lg p-1.5 text-ink-soft hover:bg-off-white hover:text-ink"
              title="Log out"
            >
              <LogOutIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4.5 py-5 md:px-8 md:py-7">
        <Outlet />
      </main>
    </div>
  )
}
