import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { authErrorMessage } from '../../lib/api/auth'
import Icon from '../../components/ui/Icon'

// The screen a password-reset link is supposed to land on.
//
// It did not exist. sendPasswordReset() pointed the email at
// /auth/callback?type=recovery, and AuthCallback — which knows nothing about
// recovery — saw a valid session and sent the person to their dashboard. So
// "Forgot password" worked right up until the moment it mattered: the email
// arrived, the link signed them in, and they never got to set a password.
//
// Supabase turns the recovery link into a real session before this renders
// (detectSessionInUrl), which is why updateUser() is enough here and no token
// is handled by hand. That session is also why leaving without finishing is
// worth warning about: they are signed in, but with the password they could
// not remember.
export default function ResetPassword() {
  const navigate = useNavigate()
  const [pass,    setPass]    = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')
  const [done,    setDone]    = useState(false)
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // A recovery link is single-use and expires. Without a session the
      // link was already used, or it timed out — say which, rather than
      // showing a form that cannot work.
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      setHasSession(!!session)
      setChecking(false)
    })()
    return () => { cancelled = true }
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (pass.length < 8)   return setError('Your new password needs at least 8 characters.')
    if (pass !== confirm)  return setError('The two passwords do not match.')

    setBusy(true); setError('')
    const { error: err } = await supabase.auth.updateUser({ password: pass })
    setBusy(false)

    if (err) return setError(authErrorMessage(err))

    setDone(true)
    // They are already signed in with the new password, so there is nothing
    // to log in to — go where they were headed.
    setTimeout(() => navigate('/dashboard', { replace: true }), 1800)
  }

  return (
    <div className="admin-login-page">
      <div className="admin-login-box">
        <Link to="/" className="logo" style={{ fontSize: '1.5rem', display: 'block', textAlign: 'center', marginBottom: '2rem' }}>COVO</Link>

        {checking ? (
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.875rem' }}>Checking your link…</p>
        ) : done ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <Icon name="verified" size={40} style={{ color: 'var(--success)', marginBottom: '1rem' }} />
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '.5rem' }}>Password changed</h1>
            <p style={{ color: 'var(--muted)', fontSize: '.875rem', lineHeight: 1.65 }}>
              You're signed in already — taking you to your dashboard.
            </p>
          </div>
        ) : !hasSession ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <Icon name="warning" size={36} style={{ color: 'var(--warning)', marginBottom: '1rem' }} />
            <h1 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '.5rem' }}>That link has expired</h1>
            <p style={{ color: 'var(--muted)', fontSize: '.875rem', lineHeight: 1.65, marginBottom: '1.5rem' }}>
              Reset links can only be used once, and they don't last long. Ask for
              a new one and it'll be in your inbox in a minute.
            </p>
            <Link to="/auth" className="btn-full" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h1 style={{ textAlign: 'center', fontSize: '1.35rem', fontWeight: 800, letterSpacing: '-.02em', marginBottom: '.35rem' }}>
              Choose a new password
            </h1>
            <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.84rem', marginBottom: '1.75rem' }}>
              Pick something you haven't used here before.
            </p>

            {error && <div className="error-banner">{error}</div>}

            <form onSubmit={submit}>
              <div className="form-group">
                <label>New password</label>
                <input type="password" placeholder="At least 8 characters" value={pass}
                  onChange={e => { setError(''); setPass(e.target.value) }}
                  autoComplete="new-password" autoFocus />
              </div>
              <div className="form-group">
                <label>Confirm new password</label>
                <input type="password" placeholder="Type it again" value={confirm}
                  onChange={e => { setError(''); setConfirm(e.target.value) }}
                  autoComplete="new-password" />
              </div>
              <button type="submit" className="btn-full" disabled={busy}>
                {busy ? 'Saving…' : 'Change password →'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
