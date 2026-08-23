import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import Landing        from './pages/Landing'
import Auth           from './pages/Auth'
import Onboarding     from './pages/Onboarding'
import BrandOnboarding from './pages/BrandOnboarding'
import Dashboard      from './pages/Dashboard'
import BrandDashboard from './pages/BrandDashboard'
import AuthCallback   from './pages/auth/AuthCallback'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminLogin     from './pages/auth/AdminLogin'

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
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/"                  element={<Landing />} />
          <Route path="/auth"              element={<Auth />} />
          <Route path="/auth/admin"        element={<AdminLogin />} />
          <Route path="/auth/callback"     element={<AuthCallback />} />

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
      </BrowserRouter>
    </AppProvider>
  )
}
