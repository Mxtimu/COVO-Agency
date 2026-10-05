import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'

// Landing and Auth are the two ways in, so they stay in the entry chunk —
// lazy-loading them would only add a round trip before first paint.
import Landing      from './pages/Landing'
import Auth         from './pages/Auth'
import AuthCallback from './pages/auth/AuthCallback'
import ResetPassword from './pages/auth/ResetPassword'
import { Privacy, Terms, DataDeletion } from './pages/legal/LegalPages'

// Everything behind a login is loaded on demand. A visitor reading the
// marketing page has no use for three dashboards and seven admin panels, and
// was downloading all of them anyway.
const Onboarding      = lazy(() => import('./pages/Onboarding'))
const BrandOnboarding = lazy(() => import('./pages/BrandOnboarding'))
const Dashboard       = lazy(() => import('./pages/Dashboard'))
const BrandDashboard  = lazy(() => import('./pages/BrandDashboard'))
const AdminDashboard  = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminLogin      = lazy(() => import('./pages/auth/AdminLogin'))

function PrivateRoute({ children }) {
  const { session, loading } = useApp()
  if (loading)  return null
  if (!session) return <Navigate to="/auth" replace />
  return children
}

function AdminRoute({ children }) {
  const { session, role, loading } = useApp()
  if (loading)          return null
  if (!session)         return <Navigate to="/auth" replace />
  if (role !== 'admin') return <Navigate to="/dashboard/brand" replace />
  return children
}

// Creator onboarding — skip if already acknowledged
function OnboardRoute({ children }) {
  const { session, profile, loading } = useApp()
  if (loading)  return null
  if (!session) return <Navigate to="/auth" replace />
  const cp = Array.isArray(profile?.creator_profiles) ? profile.creator_profiles[0] : profile?.creator_profiles
  if (cp?.guardrail_acknowledged) return <Navigate to="/dashboard/creator" replace />
  return children
}

// Brand onboarding — skip if already onboarded
function BrandOnboardRoute({ children }) {
  const { session, profile, loading } = useApp()
  if (loading)  return null
  if (!session) return <Navigate to="/auth" replace />
  const bp = Array.isArray(profile?.brand_profiles) ? profile.brand_profiles[0] : profile?.brand_profiles
  if (bp?.company_name) return <Navigate to="/dashboard/brand" replace />
  return children
}

export default function App() {
  return (
    <AppProvider>
      {/* The v7_startTransition and v7_relativeSplatPath future flags were
          opting in early to behaviour that is simply how react-router 7
          works, so they are gone with the upgrade rather than left as
          no-ops that read like they still toggle something. */}
      <BrowserRouter>
        {/* The route guards already render null while auth resolves, so a
            lazy chunk arriving a moment later shows the same blank frame
            rather than a spinner that flashes on every fast navigation. */}
        <Suspense fallback={null}>
        <Routes>
          <Route path="/"                  element={<Landing />} />
          <Route path="/auth"              element={<Auth />} />
          <Route path="/auth/admin"        element={<AdminLogin />} />
          <Route path="/auth/callback"     element={<AuthCallback />} />
          <Route path="/auth/reset"        element={<ResetPassword />} />

          {/* Public, and reachable without an account — Meta checks that
              these load before a Facebook app can go Live. */}
          <Route path="/privacy"           element={<Privacy />} />
          <Route path="/terms"             element={<Terms />} />
          <Route path="/data-deletion"     element={<DataDeletion />} />

          {/* Onboarding */}
          <Route path="/onboarding"        element={<OnboardRoute><Onboarding /></OnboardRoute>} />
          <Route path="/onboarding/brand"  element={<BrandOnboardRoute><BrandOnboarding /></BrandOnboardRoute>} />

          {/* Creator dashboard */}
          <Route path="/dashboard"         element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/dashboard/creator" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/dashboard/creator/*" element={<PrivateRoute><Dashboard /></PrivateRoute>} />

          {/* Brand dashboard */}
          <Route path="/dashboard/brand"   element={<PrivateRoute><BrandDashboard /></PrivateRoute>} />
          <Route path="/dashboard/brand/*" element={<PrivateRoute><BrandDashboard /></PrivateRoute>} />

          {/* Admin */}
          <Route path="/admin"             element={<AdminRoute><AdminDashboard /></AdminRoute>} />
          <Route path="/admin/*"           element={<AdminRoute><AdminDashboard /></AdminRoute>} />

          <Route path="*"                  element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AppProvider>
  )
}
