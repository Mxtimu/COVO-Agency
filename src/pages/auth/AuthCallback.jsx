import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'

export default function AuthCallback() {
  const navigate = useNavigate()
  const { session, profile, loading } = useApp()

  useEffect(() => {
    // Supabase may pass errors back via the URL hash or query string.
    // Check before waiting on the loading state so we surface them quickly.
    const hashParams  = new URLSearchParams(window.location.hash.slice(1))
    const queryParams = new URLSearchParams(window.location.search)
    const urlError    = hashParams.get('error') || queryParams.get('error')
    if (urlError) {
      const desc = hashParams.get('error_description') || queryParams.get('error_description') || urlError
      navigate(`/auth?error=${encodeURIComponent(desc)}`, { replace: true })
      return
    }

    if (loading) return

    if (!session) {
      navigate('/auth?error=oauth_failed', { replace: true })
      return
    }

    const role = profile?.role

    if (!role) {
      // Profile not created yet (trigger may still be running) — retry once
      const t = setTimeout(() => navigate('/auth/callback', { replace: true }), 1200)
      return () => clearTimeout(t)
    }

    // PostgREST may return the nested table as an object (1-to-1 FK) or array
    const cp = profile?.creator_profiles
    const creatorProfile = Array.isArray(cp) ? cp[0] : cp

    const bp = profile?.brand_profiles
    const brandProfile = Array.isArray(bp) ? bp[0] : bp

    if (role === 'creator') {
      navigate(creatorProfile?.guardrail_acknowledged ? '/dashboard/creator' : '/onboarding', { replace: true })
    } else if (role === 'brand') {
      navigate(brandProfile?.onboarding_complete ? '/dashboard/brand' : '/onboarding/brand', { replace: true })
    } else if (role === 'admin') {
      navigate('/admin', { replace: true })
    } else {
      navigate('/dashboard', { replace: true })
    }
  }, [session, profile, loading])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh',
      background: 'var(--ink-deep)', color: 'var(--warm-white)',
      fontFamily: 'var(--font-sans)', gap: '1rem',
    }}>
      <div style={{
        width: 40, height: 40, border: '2px solid var(--sage)',
        borderTopColor: 'transparent', borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }} />
      <p style={{ color: 'var(--tan)', fontSize: '.9rem' }}>Signing you in…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
