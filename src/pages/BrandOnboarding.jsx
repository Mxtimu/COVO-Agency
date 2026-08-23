import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import Icon from '../components/ui/Icon'

const INDUSTRIES = [
  'Fashion & Apparel', 'Beauty & Skincare', 'Health & Wellness',
  'Food & Beverage', 'Technology', 'Home & Lifestyle',
  'Sports & Fitness', 'Travel & Tourism', 'Entertainment',
  'Finance & Banking', 'Retail', 'Other',
]

export default function BrandOnboarding() {
  const navigate        = useNavigate()
  const { session, profile } = useApp()

  const prefillCompany = session?.user?.user_metadata?.company_name || ''

  const [step,     setStep]     = useState(1)
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')
  const [company,  setCompany]  = useState(prefillCompany)
  const [website,  setWebsite]  = useState('')
  const [industry, setIndustry] = useState('')
  const [bio,      setBio]      = useState('')

  const TOTAL = 3

  async function finish() {
    setBusy(true); setError('')
    const { error } = await supabase.from('brand_profiles').upsert({
      id:                  session.user.id,
      company_name:        company,
      website:             website || null,
      industry:            industry || null,
      bio:                 bio || null,
      onboarding_complete: true,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    navigate('/dashboard/brand', { replace: true })
  }

  function next() { setError(''); setStep(s => s + 1) }
  function back() { setError(''); setStep(s => s - 1) }

  return (
    <div className="onboard-page">
      <div className="onboard-wrap">
        <div className="top-bar">
          <Link to="/" className="logo" style={{ fontSize: '1.5rem' }}>COVO</Link>
          <span className="step-label">Step {step} of {TOTAL}</span>
        </div>

        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${(step / TOTAL) * 100}%` }} />
        </div>

        {/* ── STEP 1: Company Info ── */}
        {step === 1 && (
          <div className="step-card">
            <h2>Tell us about your company</h2>
            <p className="desc">This information helps creators understand who they're partnering with.</p>

            {error && <div className="error-banner" style={{ marginBottom: '1.25rem' }}>{error}</div>}

            <div className="form-group">
              <label>Company name</label>
              <input
                type="text"
                placeholder="Your Brand (Pty) Ltd"
                value={company}
                onChange={e => setCompany(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Website <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
              <input
                type="url"
                placeholder="https://yourbrand.co.za"
                value={website}
                onChange={e => setWebsite(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Industry</label>
              <div className="niche-grid" style={{ marginTop: '.35rem' }}>
                {INDUSTRIES.map(ind => (
                  <div
                    key={ind}
                    className={`niche-pill ${industry === ind ? 'selected' : ''}`}
                    onClick={() => setIndustry(ind)}
                  >
                    {ind}
                  </div>
                ))}
              </div>
            </div>

            <button
              className="btn-full"
              style={{ marginTop: '1.5rem' }}
              disabled={!company.trim()}
              onClick={() => { if (!company.trim()) return setError('Please enter your company name.'); next() }}
            >
              Continue →
            </button>
          </div>
        )}

        {/* ── STEP 2: Brand Story ── */}
        {step === 2 && (
          <div className="step-card">
            <h2>Your brand story</h2>
            <p className="desc">Give creators a sense of what your brand stands for and what you're looking for in a partnership.</p>

            {error && <div className="error-banner" style={{ marginBottom: '1.25rem' }}>{error}</div>}

            <div className="form-group">
              <label>About your brand</label>
              <textarea
                placeholder="We're a Cape Town-based skincare brand focused on natural ingredients for South African skin types. We're looking for creators who are passionate about clean beauty..."
                value={bio}
                onChange={e => setBio(e.target.value)}
                style={{
                  width: '100%', minHeight: 140,
                  padding: '.75rem 1rem',
                  background: 'var(--dark3)', border: '1px solid var(--border)',
                  borderRadius: 10, color: 'var(--warm-white)',
                  fontFamily: 'var(--font-sans)', fontSize: '.9rem',
                  lineHeight: 1.65, resize: 'vertical',
                }}
              />
              <p style={{ fontSize: '.76rem', color: 'var(--muted)', marginTop: '.35rem' }}>
                {bio.length}/500 characters
              </p>
            </div>

            <div style={{ display: 'flex', gap: '.75rem', marginTop: '1.5rem' }}>
              <button className="btn-ghost btn-lg" style={{ flex: 1, borderRadius: 10 }} onClick={back}>Back</button>
              <button className="btn-full" style={{ flex: 2 }} onClick={next}>Continue →</button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Ready to launch ── */}
        {step === 3 && (
          <div className="step-card">
            <h2>You're almost in.</h2>
            <p className="desc">Before you launch your first campaign, please read and accept our Brand Partner terms.</p>

            <div style={{
              background: 'var(--dark3)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '1.25rem 1.5rem', marginBottom: '1.5rem',
            }}>
              {[
                ['money', 'Escrow required', 'Campaign funds must be deposited into escrow before creators are invited. Campaigns pause automatically if your balance drops below R500.'],
                ['document', 'Commission honesty', 'You agree to honour all confirmed commissions within the platform\'s return window policy (14–30 days).'],
                ['handshake', 'Creator respect', 'Creators are independent partners. You may not contact them outside COVO or request work beyond the agreed campaign scope.'],
                ['disputes', 'Dispute process', 'Any commission disputes must be raised through COVO\'s dispute system within 7 days of the commission being flagged.'],
              ].map(([icon, title, text]) => (
                <div key={title} style={{ display: 'flex', gap: '.85rem', marginBottom: '1.1rem' }}>
                  <span style={{ flexShrink: 0, marginTop: '.15rem', color: 'var(--sage)' }}><Icon name={icon} size={17} /></span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '.88rem', marginBottom: '.2rem' }}>{title}</div>
                    <div style={{ fontSize: '.82rem', color: 'var(--muted)', lineHeight: 1.55 }}>{text}</div>
                  </div>
                </div>
              ))}
            </div>

            {error && <div className="error-banner" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div style={{ display: 'flex', gap: '.75rem' }}>
              <button className="btn-ghost btn-lg" style={{ flex: 1, borderRadius: 10 }} onClick={back}>Back</button>
              <button className="btn-full" style={{ flex: 2 }} onClick={finish} disabled={busy}>
                {busy ? 'Setting up…' : 'Accept & enter dashboard →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
