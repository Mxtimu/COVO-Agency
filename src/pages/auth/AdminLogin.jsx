import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { signInBrand, authErrorMessage } from '../../lib/api/auth'

export default function AdminLogin() {
  const navigate = useNavigate()
  const { session, role, loading } = useApp()

  const [form, setForm]   = useState({ email: '', pass: '' })
  const [error, setError] = useState('')
  const [busy,  setBusy]  = useState(false)

  useEffect(() => {
    if (loading) return
    if (session && role === 'admin') navigate('/admin', { replace: true })
    else if (session) navigate('/dashboard', { replace: true })
  }, [session, role, loading])

  const set = k => e => { setError(''); setForm(f => ({ ...f, [k]: e.target.value })) }

  async function login(e) {
    e.preventDefault()
    if (!form.email.includes('@')) return setError('Enter a valid email address.')
    if (!form.pass) return setError('Enter your password.')
    setBusy(true); setError('')
    const { error } = await signInBrand({ email: form.email, password: form.pass })
    setBusy(false)
    // Don't leak which admin emails exist, but do surface outages as outages.
    if (error) return setError(error.status >= 500 || error.name === 'AuthRetryableFetchError'
      ? authErrorMessage(error)
      : 'Invalid credentials.')
    // role check handled by useEffect
  }

  return (
    <div className="admin-login-page">
      <div className="admin-login-box">
        <Link to="/" className="logo" style={{ fontSize: '1.5rem', display: 'block', textAlign: 'center', marginBottom: '2rem' }}>COVO</Link>

        <div className="admin-lock-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h1 style={{ textAlign: 'center', fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-.02em', marginBottom: '.35rem' }}>Administration</h1>
        <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.84rem', marginBottom: '2rem' }}>Authorized personnel only</p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={login}>
          <div className="form-group">
            <label>Email</label>
            <input type="email" placeholder="admin@covo.africa" value={form.email} onChange={set('email')} autoComplete="email" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" placeholder="Your password" value={form.pass} onChange={set('pass')} autoComplete="current-password" />
          </div>
          <button
            type="submit"
            className="btn-full"
            disabled={busy}
            style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', color: '#FCA5A5', marginTop: '.5rem' }}
          >
            {busy ? 'Signing in…' : 'Sign in to Admin'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '1.75rem', fontSize: '.8rem' }}>
          <Link to="/auth" style={{ color: 'var(--muted)', textDecoration: 'none' }}>← Back to main login</Link>
        </p>
      </div>
    </div>
  )
}
