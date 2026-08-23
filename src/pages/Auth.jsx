import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import {
  signInWithGoogle,
  signInWithFacebook,
  signUpBrand,
  signInBrand,
  signUpCreator,
  signInCreator,
  authErrorMessage,
  isExistingUser,
} from '../lib/api/auth'
import { sendPasswordReset } from '../lib/api/emailjs'
import Icon from '../components/ui/Icon'

const BRAND_LEFT = {
  badge:   'For Brands',
  heading: 'Grow your brand with authentic creators.',
  body:    'Launch performance campaigns, set your commission rates, and only pay for real results.',
  items: [
    ['analytics', 'Real-time ROI tracking on every campaign'],
    ['links', 'Unique affiliate link per creator per campaign'],
    ['money', 'Only pay commission on confirmed sales'],
    ['shield', 'Escrow-backed — your budget is always protected'],
  ],
  proof:   { count: '340+',   label: 'brands growing with COVO' },
  avatars: [['#C3CE94','N'],['#A8B47A','K'],['#D2B8F2','T'],['#C1B7AA','S'],['#634D3F','M']],
}

const CREATOR_LEFT = {
  badge:   'For Creators',
  heading: 'Turn your influence into real income.',
  body:    'Join vetted brand campaigns, share your unique link with your audience, and earn on every conversion.',
  items: [
    ['score', 'Get a COVO Score that brands compete for'],
    ['links', 'Your own trackable affiliate link per brand'],
    ['money', 'Commissions confirmed and paid directly to you'],
    ['trending', 'See your clicks, conversions and earnings live'],
  ],
  proof:   { count: '2,400+', label: 'creators earning on COVO' },
  avatars: [['#D2B8F2','A'],['#C3CE94','L'],['#C1B7AA','M'],['#634D3F','J'],['#10B981','P']],
}

export default function Auth() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { session, loading, role, profile } = useApp()

  // intent drives which form is shown after role is picked
  const [intent,       setIntent]       = useState(params.get('mode') === 'login' ? 'login' : 'signup')
  const [userType,     setUserType]     = useState(params.get('type') || null) // null = role picker
  const [creatorEmail, setCreatorEmail] = useState(false)
  const [view,         setView]         = useState('form') // 'form' | 'forgot' | 'forgot-sent'
  const [error,        setError]        = useState('')
  const [info,         setInfo]         = useState('')
  const [busy,         setBusy]         = useState(false)
  const [form,         setForm]         = useState({ first: '', last: '', company: '', email: '', pass: '', confirm: '' })

  useEffect(() => {
    if (loading || !session) return
    const bp = Array.isArray(profile?.brand_profiles)   ? profile.brand_profiles[0]   : profile?.brand_profiles
    const cp = Array.isArray(profile?.creator_profiles) ? profile.creator_profiles[0] : profile?.creator_profiles
    if (role === 'admin')   navigate('/admin', { replace: true })
    else if (role === 'brand')   navigate(bp?.company_name ? '/dashboard/brand' : '/onboarding/brand', { replace: true })
    else if (role === 'creator') navigate(cp?.guardrail_acknowledged ? '/dashboard/creator' : '/onboarding', { replace: true })
    else navigate('/dashboard', { replace: true })
  }, [session, loading, role])

  const set = k => e => { setError(''); setInfo(''); setForm(f => ({ ...f, [k]: e.target.value })) }

  function pickType(t) {
    setUserType(t); setError(''); setInfo(''); setView('form'); setCreatorEmail(false)
  }

  // Switch intent AND go back to role picker
  function switchToLogin()  { setIntent('login');  setUserType(null); setError(''); setInfo(''); setView('form'); setCreatorEmail(false) }
  function switchToSignup() { setIntent('signup'); setUserType(null); setError(''); setInfo(''); setView('form'); setCreatorEmail(false) }

  // ── Auth handlers ──────────────────────────────────────────────────────────
  async function handleGoogle()   { setBusy(true); const { error } = await signInWithGoogle();   if (error) { setError(authErrorMessage(error)); setBusy(false) } }
  async function handleFacebook() { setBusy(true); const { error } = await signInWithFacebook(); if (error) { setError(authErrorMessage(error)); setBusy(false) } }

  async function brandRegister(e) {
    e.preventDefault()
    if (!form.first || !form.last)  return setError('Please enter your first and last name.')
    if (!form.company)              return setError('Please enter your company name.')
    if (!form.email.includes('@'))  return setError('Please enter a valid email address.')
    if (form.pass.length < 8)      return setError('Password must be at least 8 characters.')
    if (form.pass !== form.confirm) return setError('Passwords do not match.')
    setBusy(true); setError('')
    const { data, error } = await signUpBrand({ email: form.email, password: form.pass, fullName: `${form.first} ${form.last}`, companyName: form.company })
    setBusy(false)
    if (error) return setError(authErrorMessage(error))
    if (isExistingUser(data)) return setError('An account with this email already exists. Try signing in instead.')
    if (data?.session) return // confirmation off — the session effect redirects
    setInfo('Check your email to confirm your account, then come back to log in.')
  }

  async function brandLogin(e) {
    e.preventDefault()
    if (!form.email.includes('@')) return setError('Please enter a valid email address.')
    if (!form.pass)                return setError('Please enter your password.')
    setBusy(true); setError('')
    const { error } = await signInBrand({ email: form.email, password: form.pass })
    setBusy(false)
    if (error) return setError(authErrorMessage(error))
  }

  async function creatorRegister(e) {
    e.preventDefault()
    if (!form.first || !form.last)  return setError('Please enter your first and last name.')
    if (!form.email.includes('@'))  return setError('Please enter a valid email address.')
    if (form.pass.length < 8)      return setError('Password must be at least 8 characters.')
    if (form.pass !== form.confirm) return setError('Passwords do not match.')
    setBusy(true); setError('')
    const { data, error } = await signUpCreator({ email: form.email, password: form.pass, fullName: `${form.first} ${form.last}` })
    setBusy(false)
    if (error) return setError(authErrorMessage(error))
    if (isExistingUser(data)) return setError('An account with this email already exists. Try signing in instead.')
    if (data?.session) return // confirmation off — the session effect redirects
    setInfo('Check your email to confirm your account, then come back to log in.')
  }

  async function creatorLogin(e) {
    e.preventDefault()
    if (!form.email.includes('@')) return setError('Please enter a valid email address.')
    if (!form.pass)                return setError('Please enter your password.')
    setBusy(true); setError('')
    const { error } = await signInCreator({ email: form.email, password: form.pass })
    setBusy(false)
    if (error) return setError(authErrorMessage(error))
  }

  async function handleForgot(e) {
    e.preventDefault()
    if (!form.email.includes('@')) return setError('Enter a valid email address.')
    setBusy(true); setError('')
    const { error } = await sendPasswordReset(form.email)
    setBusy(false)
    if (error) return setError(error.message)
    setView('forgot-sent')
  }

  // ── ROLE PICKER ─────────────────────────────────────────────────────────────
  if (!userType) {
    const isLogin = intent === 'login'
    return (
      <div className="auth-picker-page">
        <div className="auth-picker-inner">
          <button className="auth-picker-logo logo" onClick={() => navigate('/auth/admin')} title="Admin access">COVO</button>

          <h1 className="auth-picker-title">{isLogin ? 'Welcome back' : 'Join COVO'}</h1>
          <p className="auth-picker-sub">{isLogin ? 'Continue as...' : 'Who are you joining as?'}</p>

          <div className="auth-picker-cards">
            <div className="auth-pick-card brand" onClick={() => pickType('brand')}>
              <div className="pick-icon">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                  <line x1="12" y1="12" x2="12" y2="16" />
                  <line x1="10" y1="14" x2="14" y2="14" />
                </svg>
              </div>
              <h2>{isLogin ? 'Brand' : "I'm a Brand"}</h2>
              <p>{isLogin ? 'Sign in to your brand account.' : 'Launch influencer campaigns, track conversions, and pay creators on performance.'}</p>
              <div className="pick-cta brand">{isLogin ? 'Log in as brand →' : 'Get started →'}</div>
            </div>

            <div className="auth-pick-card creator" onClick={() => pickType('creator')}>
              <div className="pick-icon">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <h2>{isLogin ? 'Creator / Influencer' : "I'm an Influencer"}</h2>
              <p>{isLogin ? 'Sign in to your creator account.' : 'Join brand campaigns, share your unique link, and earn real commission on every sale.'}</p>
              <div className="pick-cta creator">{isLogin ? 'Log in as creator →' : 'Start earning →'}</div>
            </div>
          </div>

          <p className="auth-picker-admin-hint" style={{ marginBottom: '.65rem' }}>
            {isLogin
              ? <>New to COVO? <button className="link-btn" onClick={switchToSignup}>Create an account</button></>
              : <>Already have an account? <button className="link-btn" onClick={switchToLogin}>Sign in</button></>
            }
          </p>
          <p className="auth-picker-admin-hint">
            Admin? <button className="link-btn" onClick={() => navigate('/auth/admin')}>Sign in here</button>
          </p>
        </div>
      </div>
    )
  }

  const left = userType === 'brand' ? BRAND_LEFT : CREATOR_LEFT
  const isSignup = intent === 'signup'

  // ── FORGOT PASSWORD ──────────────────────────────────────────────────────────
  const forgotContent = view === 'forgot-sent' ? (
    <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
      <Icon name="mail" size={40} style={{ marginBottom: '1rem', opacity: .7 }} />
      <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '.5rem' }}>Check your inbox</h2>
      <p style={{ color: 'var(--muted)', fontSize: '.875rem', lineHeight: 1.65 }}>
        We sent a password reset link to <strong style={{ color: 'var(--warm-white)' }}>{form.email}</strong>. It may take a minute to arrive.
      </p>
      <button className="btn-full" style={{ marginTop: '1.75rem' }} onClick={() => setView('form')}>
        Back to sign in
      </button>
    </div>
  ) : (
    <form onSubmit={handleForgot}>
      <button type="button" className="back-btn" onClick={() => setView('form')}>← Back</button>
      <h1 style={{ marginBottom: '.4rem' }}>Reset your password</h1>
      <p className="sub" style={{ marginBottom: '1.75rem' }}>Enter your email and we'll send you a reset link.</p>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-group">
        <label>Email address</label>
        <input type="email" placeholder="your@email.com" value={form.email} onChange={set('email')} autoComplete="email" />
      </div>
      <button type="submit" className="btn-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link →'}</button>
    </form>
  )

  // ── BRAND FORM ───────────────────────────────────────────────────────────────
  const brandContent = (
    <>
      <div className="auth-box-header">
        <h1>{isSignup ? 'Create your brand account' : 'Welcome back'}</h1>
        <button className="type-switch-btn" onClick={() => setUserType(null)}>← Change</button>
      </div>

      {error && <div className="error-banner" style={{ marginTop: '.75rem' }}>{error}</div>}
      {info  && <div className="success-banner" style={{ marginTop: '.75rem' }}>{info}</div>}

      {isSignup ? (
        <>
          <form onSubmit={brandRegister} style={{ marginTop: '1.25rem' }}>
            <div className="form-row">
              <div className="form-group"><label>First name</label><input type="text" placeholder="John" value={form.first} onChange={set('first')} autoComplete="given-name" /></div>
              <div className="form-group"><label>Last name</label><input type="text" placeholder="Doe" value={form.last} onChange={set('last')} autoComplete="family-name" /></div>
            </div>
            <div className="form-group"><label>Company name</label><input type="text" placeholder="Your Brand (Pty) Ltd" value={form.company} onChange={set('company')} /></div>
            <div className="form-group"><label>Email address</label><input type="email" placeholder="john@yourbrand.com" value={form.email} onChange={set('email')} autoComplete="email" /></div>
            <div className="form-group"><label>Password</label><input type="password" placeholder="At least 8 characters" value={form.pass} onChange={set('pass')} autoComplete="new-password" /></div>
            <div className="form-group"><label>Confirm password</label><input type="password" placeholder="Repeat your password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" /></div>
            <button type="submit" className="btn-full" disabled={busy}>{busy ? 'Creating account…' : 'Create account →'}</button>
            <p className="auth-terms">By registering you agree to our <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a></p>
          </form>
          <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '.84rem', color: 'var(--muted)' }}>
            Already have an account?{' '}
            <button className="link-btn" onClick={switchToLogin}>Sign in</button>
          </p>
        </>
      ) : (
        <>
          <form onSubmit={brandLogin} style={{ marginTop: '1.25rem' }}>
            <div className="form-group"><label>Email address</label><input type="email" placeholder="john@yourbrand.com" value={form.email} onChange={set('email')} autoComplete="email" /></div>
            <div className="form-group"><label>Password</label><input type="password" placeholder="Your password" value={form.pass} onChange={set('pass')} autoComplete="current-password" /></div>
            <div className="forgot"><a href="#" onClick={e => { e.preventDefault(); setView('forgot') }}>Forgot password?</a></div>
            <button type="submit" className="btn-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in →'}</button>
          </form>
          <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '.84rem', color: 'var(--muted)' }}>
            New to COVO?{' '}
            <button className="link-btn" onClick={switchToSignup}>Create an account</button>
          </p>
        </>
      )}
    </>
  )

  // ── CREATOR FORM ─────────────────────────────────────────────────────────────
  const creatorContent = (
    <>
      <div className="auth-box-header">
        <h1>{isSignup ? 'Join as a creator' : 'Welcome back'}</h1>
        <button className="type-switch-btn" onClick={() => setUserType(null)}>← Change</button>
      </div>
      <p className="sub" style={{ marginTop: '.4rem', marginBottom: '1.5rem' }}>
        {isSignup ? 'Sign up with your preferred account.' : 'Sign in to your creator account.'}
      </p>

      {error && <div className="error-banner">{error}</div>}
      {info  && <div className="success-banner">{info}</div>}

      {!creatorEmail ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem', marginBottom: '1.25rem' }}>
            <button className="social-btn-lg" onClick={handleGoogle} disabled={busy}>
              <span className="s-icon-lg">G</span>Continue with Google
            </button>
            <button className="social-btn-lg" onClick={handleFacebook} disabled={busy}>
              <span className="s-icon-lg">f</span>Continue with Facebook
            </button>
            <button className="social-btn-lg" disabled style={{ opacity: .38, cursor: 'not-allowed' }}>
              <span className="s-icon-lg">T</span>
              Continue with TikTok
              <span style={{ marginLeft: 'auto', fontSize: '.72rem', color: 'var(--muted)', fontWeight: 400 }}>Coming soon</span>
            </button>
          </div>

          <div className="divider"><hr /><span>or use email</span><hr /></div>

          <button className="social-btn-lg" style={{ marginBottom: '1.25rem' }} onClick={() => { setCreatorEmail(true); setError(''); setInfo('') }}>
            <span className="s-icon-lg">@</span>Continue with Email
          </button>

          <div className="auth-creator-note">
            <Icon name="lock" size={14} />
            <p>COVO uses OAuth — we never see or store your social media password. Your account stays fully yours.</p>
          </div>

          <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '.84rem', color: 'var(--muted)' }}>
            {isSignup
              ? <>Already have an account? <button className="link-btn" onClick={switchToLogin}>Sign in</button></>
              : <>New to COVO? <button className="link-btn" onClick={switchToSignup}>Create an account</button></>
            }
          </p>
        </>
      ) : (
        <>
          {isSignup ? (
            <form onSubmit={creatorRegister}>
              <div className="form-row">
                <div className="form-group"><label>First name</label><input type="text" placeholder="Aisha" value={form.first} onChange={set('first')} autoComplete="given-name" /></div>
                <div className="form-group"><label>Last name</label><input type="text" placeholder="Dlamini" value={form.last} onChange={set('last')} autoComplete="family-name" /></div>
              </div>
              <div className="form-group"><label>Email address</label><input type="email" placeholder="you@email.com" value={form.email} onChange={set('email')} autoComplete="email" /></div>
              <div className="form-group"><label>Password</label><input type="password" placeholder="At least 8 characters" value={form.pass} onChange={set('pass')} autoComplete="new-password" /></div>
              <div className="form-group"><label>Confirm password</label><input type="password" placeholder="Repeat your password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" /></div>
              <button type="submit" className="btn-full" disabled={busy}>{busy ? 'Creating account…' : 'Create creator account →'}</button>
              <p className="auth-terms">By registering you agree to our <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a></p>
            </form>
          ) : (
            <form onSubmit={creatorLogin}>
              <div className="form-group"><label>Email address</label><input type="email" placeholder="you@email.com" value={form.email} onChange={set('email')} autoComplete="email" /></div>
              <div className="form-group"><label>Password</label><input type="password" placeholder="Your password" value={form.pass} onChange={set('pass')} autoComplete="current-password" /></div>
              <div className="forgot"><a href="#" onClick={e => { e.preventDefault(); setView('forgot') }}>Forgot password?</a></div>
              <button type="submit" className="btn-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in →'}</button>
            </form>
          )}
          <button className="back-btn" style={{ marginTop: '1rem' }} onClick={() => { setCreatorEmail(false); setError(''); setInfo('') }}>
            ← Back to social sign-in
          </button>
        </>
      )}
    </>
  )

  return (
    <div className="auth-page">
      <div className={`auth-left auth-left--${userType}`}>
        <div className="left-glow-1" />
        <div className="left-glow-2" />
        <Link to="/" className="logo" style={{ fontSize: '1.75rem' }}>COVO</Link>
        <div className="left-content">
          <div className={`auth-type-badge auth-type-badge--${userType}`}>{left.badge}</div>
          <h2>{left.heading}</h2>
          <p>{left.body}</p>
          <div className="trust-items">
            {left.items.map(([icon, text]) => (
              <div className="trust-item" key={text}>
                <span className="trust-item-icon"><Icon name={icon} size={16} /></span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="social-proof">
          <div className="avatars">
            {left.avatars.map(([bg, l]) => (
              <div className="av" key={l + bg} style={{ background: bg }}>{l}</div>
            ))}
          </div>
          <p><strong>{left.proof.count}</strong> {left.proof.label}</p>
        </div>
      </div>

      <div className="auth-right">
        <div className="auth-box">
          {view !== 'form' ? forgotContent : userType === 'brand' ? brandContent : creatorContent}
        </div>
      </div>
    </div>
  )
}
