import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { takePendingRole, claimAccountRole } from '../../lib/api/auth'

export default function AuthCallback() {
  const navigate = useNavigate()
  const { session, profile, loading, refreshProfile } = useApp()
  const claimedRef = useRef(false)
  const [claimIssue, setClaimIssue] = useState(null)

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

    // A recovery link carries type=recovery, in the hash for an implicit
    // flow and the query string for PKCE. Without this check the session it
    // creates looked like any other sign-in and the person was sent to their
    // dashboard — still holding the password they had forgotten.
    const flowType = hashParams.get('type') || queryParams.get('type')
    if (flowType === 'recovery') {
      navigate('/auth/reset', { replace: true })
      return
    }

    if (loading) return

    if (!session) {
      navigate('/auth?error=oauth_failed', { replace: true })
      return
    }

    // linkIdentity() redirects here when a social login is attached to an
    // account that already exists. Nothing needs claiming — the account and
    // its role are unchanged — so honour ?next and send them back to the
    // page they started from.
    //
    // Internal paths only: a `next` of https://evil.example would otherwise
    // turn this callback into an open redirect, and it runs behind a real
    // session. The `//` check blocks protocol-relative URLs, which start
    // with a slash but still leave the site.
    const next = queryParams.get('next')
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      navigate(next, { replace: true })
      return
    }

    const role = profile?.role

    if (!role) {
      // Profile not created yet (trigger may still be running) — retry once
      const t = setTimeout(() => navigate('/auth/callback', { replace: true }), 1200)
      return () => clearTimeout(t)
    }

    // Settle the account type the person picked before being sent to the
    // provider. handle_new_user() had nothing to go on and defaulted to
    // 'creator', so without this a brand signing in with Google lands in
    // creator onboarding with no way out (role_claim.sql explains why the
    // role is claimed here rather than passed through OAuth).
    //
    // Guarded by a ref because this effect reruns as the profile loads, and
    // claiming is cheap but routing twice is a visible flicker.
    const pending = claimedRef.current ? null : takePendingRole()

    if (pending && pending !== role) {
      claimedRef.current = true
      claimAccountRole(pending).then(({ claimed, outcome }) => {
        if (claimed) {
          // refreshProfile so the route guards see the new role rather than
          // the 'creator' the signup trigger wrote.
          if (refreshProfile) refreshProfile()
          navigate(pending === 'brand' ? '/onboarding/brand' : '/onboarding', { replace: true })
          return
        }

        // The claim was refused — the account already has activity on it, or
        // its type was settled before. Routing them on without a word would
        // be the silent failure this whole flow exists to remove: they asked
        // to sign in as a brand and would land in a creator dashboard with
        // no idea why. Say it, then let them continue.
        //
        // The server's own sentence is logged rather than shown: it is
        // written for an API caller and repeats what the screen already
        // says ("already set up as a creator" / "your account type is
        // already set"), which reads like a stutter.
        console.warn('[auth] role claim refused:', outcome)
        setClaimIssue({ wanted: pending, actual: role })
      })
      return
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

  const shell = {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', minHeight: '100vh', padding: '1.5rem',
    background: 'var(--ink-deep)', color: 'var(--warm-white)',
    fontFamily: 'var(--font-sans)', gap: '1rem', textAlign: 'center',
  }

  if (claimIssue) {
    const wanted = claimIssue.wanted === 'brand' ? 'a brand' : 'a creator'
    const actual = claimIssue.actual === 'brand' ? 'a brand' : 'a creator'
    return (
      <div style={shell}>
        <h1 style={{ fontSize: '1.15rem', margin: 0 }}>
          You are signed in as {actual}
        </h1>
        <p style={{ color: 'var(--tan)', fontSize: '.9rem', maxWidth: '27rem', lineHeight: 1.55 }}>
          You chose to continue as {wanted}, but this account is already {actual} and
          its type cannot be changed. Once an account has campaigns, earnings or
          payouts behind it, it stays as it is.
        </p>
        <p style={{ color: 'var(--muted)', fontSize: '.8rem', maxWidth: '27rem', lineHeight: 1.55 }}>
          To run {wanted} account as well, sign up with a different email address —
          one login can only be one kind of account.
        </p>
        <button
          className="social-btn-lg"
          style={{ maxWidth: '18rem' }}
          onClick={() => navigate(claimIssue.actual === 'brand' ? '/dashboard/brand' : '/dashboard/creator', { replace: true })}
        >
          Continue as {actual}
        </button>
      </div>
    )
  }

  return (
    <div style={shell}>
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
