import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { ForgotPassword } from './pages/ForgotPassword'
import { ResetPassword } from './pages/ResetPassword'
import { Products } from './pages/Products'
import { ProductDetail } from './pages/ProductDetail'
import { Projects } from './pages/Projects'
import { BookingBoard } from './pages/BookingBoard'
import { Carnets } from './pages/Carnets'
import { DeliveryNotes } from './pages/DeliveryNotes'
import { Users } from './pages/Users'
import { ServiceRecords } from './pages/ServiceRecords'
import { ServiceRecordDetail } from './pages/ServiceRecordDetail'
import { ReportFault } from './pages/ReportFault'
import { Settings } from './pages/Settings'
import { ForcedPasswordChange } from './pages/ForcedPasswordChange'

// Gates the entire authenticated shell — a must_change_password session
// sees ONLY ForcedPasswordChange, not <Layout> or any route inside it, so
// there's no nav to escape through. The backend enforces the same
// restriction on every /api call (RequirePasswordSet), so this isn't just
// a client-side nicety.
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-8 text-[13px] text-ink-soft">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.must_change_password) return <ForcedPasswordChange />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <Navigate to="/products" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/report-fault" element={<ReportFault />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/products" replace />} />
        <Route path="/products" element={<Products />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<BookingBoard />} />
        <Route path="/carnets" element={<Carnets />} />
        <Route path="/delivery-notes" element={<DeliveryNotes />} />
        <Route path="/services" element={<ServiceRecords />} />
        <Route path="/services/:id" element={<ServiceRecordDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route
          path="/users"
          element={
            <RequireAdmin>
              <Users />
            </RequireAdmin>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
