import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import Icon from '../components/ui/Icon'

const NICHES = [
  { id: 'sports',    icon: 'fitness', label: 'Sports & Fitness' },
  { id: 'wellness',  icon: 'wellness', label: 'Wellness'         },
  { id: 'hygiene',   icon: 'health', label: 'Personal Care'    },
  { id: 'fashion',   icon: 'fashion', label: 'Fashion & Style'  },
  { id: 'food',      icon: 'food', label: 'Food & Drink'     },
  { id: 'tech',      icon: 'tech', label: 'Technology'       },
  { id: 'travel',    icon: 'travel', label: 'Travel'           },
  { id: 'gaming',    icon: 'gaming', label: 'Gaming'           },
  { id: 'beauty',    icon: 'beauty', label: 'Beauty & Skincare'},
  { id: 'lifestyle', icon: 'nature', label: 'Lifestyle'        },
  { id: 'business',  icon: 'trending', label: 'Business'         },
  { id: 'education', icon: 'books', label: 'Education'        },
  { id: 'parenting', icon: 'parenting', label: 'Parenting'        },
  { id: 'music',     icon: 'tiktok', label: 'Music'            },
  { id: 'pets',      icon: 'pets', label: 'Pets'             },
  { id: 'home',      icon: 'home', label: 'Home & Decor'     },
]

const SOCIALS = [
  { id: 'ig', icon: 'instagram', name: 'Instagram', desc: 'Connect to show follower count & engagement rate' },
  { id: 'tt', icon: 'tiktok', name: 'TikTok',    desc: 'Connect to show your video views & audience data' },
  { id: 'fb', icon: 'profile', name: 'Facebook',  desc: 'Connect your page to show page reach'             },
  { id: 'yt', icon: 'youtube', name: 'YouTube',   desc: 'Connect your channel to show subscriber count'    },
]

const GENDERS   = ['Male', 'Female', 'Non-binary', 'Prefer not to say']
const COUNTRIES = ['United Kingdom','United States','South Africa','Nigeria','Kenya','Ghana','Canada','Australia','Germany','France','Netherlands','Sweden','Brazil','India','UAE','Other']

export default function Onboarding() {
  const navigate        = useNavigate()
  const { session }     = useApp()

  const [step,     setStep]     = useState(1)
  const [niches,   setNiches]   = useState([])
  const [gender,   setGender]   = useState(null)
  const [location, setLocation] = useState('')
  const [bio,      setBio]      = useState('')
  const [handle,   setHandle]   = useState('')
  const [socials,  setSocials]  = useState([])
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')

  const progress = step > 4 ? 100 : (step / 4) * 100

  function toggleNiche(id) {
    setNiches(prev => prev.includes(id) ? prev.filter(n => n !== id) : [...prev, id])
  }

  function connectSocial(id) {
    setSocials(prev => prev.includes(id) ? prev : [...prev, id])
  }

  async function finish() {
    setBusy(true); setError('')
    const { error } = await supabase
      .from('creator_profiles')
      .upsert({
        id:                          session.user.id,
        niches,
        gender,
        location,
        bio,
        primary_handle:              handle,
        guardrail_acknowledged:      true,
        guardrail_acknowledged_at:   new Date().toISOString(),
      })

    setBusy(false)
    if (error) { setError(error.message); return }
    setStep(5)
  }

  return (
    <div className="onboard-page">
      <div className="onboard-wrap">
        <div className="top-bar">
          <Link to="/" className="logo">COVO</Link>
          <span className="step-label">{step <= 4 ? `Step ${step} of 4` : 'Complete'}</span>
        </div>

        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>

        {/* STEP 1 — Niches */}
        {step === 1 && (
          <div className="step-card">
            <h2>Select your niches</h2>
            <p className="desc">Pick the categories that best represent your content. Select all that apply.</p>
            <div className="niche-grid">
              {NICHES.map(n => (
                <div key={n.id} className={`niche-pill ${niches.includes(n.id) ? 'selected' : ''}`} onClick={() => toggleNiche(n.id)}>
                  <span><Icon name={n.icon} size={17} /></span>
                  <span>{n.label}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '1rem' }}>Select at least 1 category</p>
            <div className="nav-btns">
              <div />
              <button className="btn-next" disabled={niches.length === 0} onClick={() => setStep(2)}>Continue →</button>
            </div>
          </div>
        )}

        {/* STEP 2 — About You */}
        {step === 2 && (
          <div className="step-card">
            <h2>About you</h2>
            <p className="desc">Tell us a little more so we can match you with the right opportunities.</p>

            <div className="form-group">
              <label>Gender</label>
              <div className="gender-options">
                {GENDERS.map(g => (
                  <button key={g} type="button" className={`gender-btn ${gender === g ? 'selected' : ''}`} onClick={() => setGender(g)}>{g}</button>
                ))}
              </div>
            </div>

            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label>Country / Location</label>
              <select value={location} onChange={e => setLocation(e.target.value)}>
                <option value="" disabled>Select your country</option>
                {COUNTRIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Bio / About you <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
              <textarea placeholder="Tell brands what makes your content unique..." value={bio} onChange={e => setBio(e.target.value)} />
            </div>

            <div className="form-group">
              <label>Primary social handle <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
              <input type="text" placeholder="@yourusername" value={handle} onChange={e => setHandle(e.target.value)} />
            </div>

            <div className="nav-btns">
              <button className="btn-back" onClick={() => setStep(1)}>← Back</button>
              <button className="btn-next" onClick={() => setStep(3)}>Continue →</button>
            </div>
          </div>
        )}

        {/* STEP 3 — Connect Socials */}
        {step === 3 && (
          <div className="step-card">
            <h2>Connect your socials</h2>
            <p className="desc">Link your accounts so brands can see your reach. You can do this later too.</p>
            <div className="social-connect-list">
              {SOCIALS.map(s => (
                <div className="social-row" key={s.id}>
                  <span className="social-row-icon"><Icon name={s.icon} size={18} /></span>
                  <div className="social-row-info">
                    <strong>{s.name}</strong>
                    <span>{s.desc}</span>
                  </div>
                  <button
                    className={`connect-btn ${socials.includes(s.id) ? 'connected' : ''}`}
                    onClick={() => connectSocial(s.id)}
                    disabled={socials.includes(s.id)}
                  >
                    {socials.includes(s.id) ? 'Connected' : 'Connect'}
                  </button>
                </div>
              ))}
            </div>
            <div className="nav-btns">
              <button className="btn-back" onClick={() => setStep(2)}>← Back</button>
              <button className="btn-next" onClick={() => setStep(4)}>Continue →</button>
            </div>
            <div className="skip-link">
              <a onClick={() => setStep(4)}>Skip for now</a>
            </div>
          </div>
        )}

        {/* STEP 4 — Guardrail */}
        {step === 4 && (
          <div className="step-card">
            <h2>Before you start</h2>
            <p className="desc">Please read and acknowledge the COVO creator guidelines.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              {[
                ['target', 'Only promote products you genuinely believe in'],
                ['megaphone', 'Always disclose sponsored content to your audience'],
                ['lock', 'Never share your affiliate links or credentials with others'],
                ['disputes', 'Comply with ASA / CAP advertising standards in your region'],
                ['message', 'Engage authentically — no fake reviews or inflated claims'],
              ].map(([icon, text]) => (
                <div key={text} style={{ display: 'flex', gap: '.85rem', alignItems: 'flex-start', padding: '.85rem 1rem', background: 'var(--dark3)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <span style={{ flexShrink: 0, marginTop: '.15rem', color: 'var(--sage)' }}><Icon name={icon} size={17} /></span>
                  <span style={{ fontSize: '.875rem', lineHeight: 1.55, color: 'var(--tan)' }}>{text}</span>
                </div>
              ))}
            </div>
            {error && <div className="error-banner">{error}</div>}
            <div className="nav-btns">
              <button className="btn-back" onClick={() => setStep(3)}>← Back</button>
              <button className="btn-next" onClick={finish} disabled={busy}>
                {busy ? 'Saving…' : 'I agree — finish setup →'}
              </button>
            </div>
          </div>
        )}

        {/* STEP 5 — Done */}
        {step === 5 && (
          <div className="step-card">
            <div className="done-wrap">
              <div className="done-emoji"><Icon name="celebrate" size={44} /></div>
              <h2>You're all set!</h2>
              <p>Your profile is live. Brands can now discover you, and you can start browsing campaigns, building your storefront, and generating affiliate links.</p>
              <button className="btn-next" style={{ maxWidth: 300, margin: '0 auto' }} onClick={() => navigate('/dashboard')}>
                Go to my dashboard →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
