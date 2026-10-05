import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import DeleteAccount from '../dashboard/DeleteAccount'
import LinkedLogins from '../settings/LinkedLogins'

const INDUSTRIES = [
  'Fashion & Apparel', 'Beauty & Skincare', 'Health & Wellness',
  'Food & Beverage', 'Technology', 'Home & Lifestyle',
  'Sports & Fitness', 'Travel & Tourism', 'Entertainment',
  'Finance & Banking', 'Retail', 'Other',
]

export default function BrandProfile() {
  const { session, profile } = useApp()

  const bp = Array.isArray(profile?.brand_profiles) ? profile.brand_profiles[0] : profile?.brand_profiles

  const [editing, setEditing] = useState(false)
  const [busy,    setBusy]    = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')
  const [form, setForm] = useState({
    company_name: bp?.company_name || '',
    website:      bp?.website      || '',
    industry:     bp?.industry     || '',
    bio:          bp?.bio          || '',
  })

  // Sync when profile loads
  useEffect(() => {
    if (bp) setForm({
      company_name: bp.company_name || '',
      website:      bp.website      || '',
      industry:     bp.industry     || '',
      bio:          bp.bio          || '',
    })
  }, [profile])

  const setF = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  async function save() {
    setBusy(true); setError('')
    const { error } = await supabase.from('brand_profiles').upsert({
      id:           session.user.id,
      company_name: form.company_name,
      website:      form.website || null,
      industry:     form.industry || null,
      bio:          form.bio || null,
      onboarding_complete: true,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  function cancel() { setEditing(false); setError(''); setForm({ company_name: bp?.company_name || '', website: bp?.website || '', industry: bp?.industry || '', bio: bp?.bio || '' }) }

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <h2>Brand Profile</h2>
        {!editing && (
          <button onClick={() => setEditing(true)} style={{ background: 'var(--dark3)', border: '1px solid var(--border)', color: 'var(--warm-white)', padding: '.4rem 1rem', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '.82rem' }}>
            Edit profile
          </button>
        )}
      </div>

      {saved && <div className="success-banner" style={{ marginBottom: '1rem' }}>Profile saved successfully.</div>}

      <div className="panel-section">
        {!editing ? (
          <div>
            <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', fontWeight: 800, color: 'white', flexShrink: 0 }}>
                {(form.company_name?.[0] || 'B').toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.2rem' }}>{form.company_name || '—'}</div>
                <div style={{ fontSize: '.82rem', color: 'var(--muted)', marginTop: '.2rem' }}>{form.industry || 'Industry not set'}</div>
              </div>
            </div>

            {[
              { label: 'Website',  value: form.website  || 'Not set' },
              { label: 'Industry', value: form.industry || 'Not set' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', gap: '1rem', padding: '.65rem 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '.78rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', width: 90, flexShrink: 0, paddingTop: '.1rem' }}>{label}</span>
                <span style={{ fontSize: '.875rem' }}>{value}</span>
              </div>
            ))}
            <div style={{ padding: '.75rem 0' }}>
              <div style={{ fontSize: '.78rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.5rem' }}>About</div>
              <div style={{ fontSize: '.875rem', color: form.bio ? 'var(--warm-white)' : 'var(--muted)', lineHeight: 1.65 }}>
                {form.bio || 'No description added yet.'}
              </div>
            </div>
          </div>
        ) : (
          <div>
            {error && <div className="error-banner" style={{ marginBottom: '1rem' }}>{error}</div>}
            <div className="form-group">
              <label>Company name</label>
              <input type="text" value={form.company_name} onChange={setF('company_name')} placeholder="Your Brand (Pty) Ltd" />
            </div>
            <div className="form-group">
              <label>Website</label>
              <input type="url" value={form.website} onChange={setF('website')} placeholder="https://yourbrand.co.za" />
            </div>
            <div className="form-group">
              <label>Industry</label>
              <div className="niche-grid" style={{ marginTop: '.35rem' }}>
                {INDUSTRIES.map(ind => (
                  <div key={ind} className={`niche-pill ${form.industry === ind ? 'selected' : ''}`} onClick={() => setForm(f => ({ ...f, industry: ind }))}>
                    {ind}
                  </div>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>About your brand</label>
              <textarea
                value={form.bio}
                onChange={setF('bio')}
                placeholder="Tell creators what your brand stands for..."
                style={{ width: '100%', minHeight: 110, padding: '.65rem .9rem', background: 'var(--dark3)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--warm-white)', fontFamily: 'var(--font-sans)', fontSize: '.87rem', lineHeight: 1.6, resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '.65rem', marginTop: '.5rem' }}>
              <button onClick={cancel} style={{ flex: 1, padding: '.65rem', background: 'var(--dark3)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--warm-white)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>Cancel</button>
              <button onClick={save} disabled={busy} className="btn-full" style={{ flex: 2 }}>{busy ? 'Saving…' : 'Save profile'}</button>
            </div>
          </div>
        )}
      </div>

      <div className="panel-section" style={{ marginTop: '1rem' }}>
        <h3 style={{ marginBottom: '.75rem' }}>Account</h3>
        <div style={{ fontSize: '.875rem', color: 'var(--muted)' }}>
          <div style={{ display: 'flex', gap: '1rem', padding: '.5rem 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ width: 80, flexShrink: 0 }}>Email</span>
            <span style={{ color: 'var(--warm-white)' }}>{session?.user?.email}</span>
          </div>
          <div style={{ display: 'flex', gap: '1rem', padding: '.5rem 0' }}>
            <span style={{ width: 80, flexShrink: 0 }}>Role</span>
            <span style={{ color: 'var(--sage)', fontWeight: 600, textTransform: 'capitalize' }}>{profile?.role}</span>
          </div>
        </div>
      </div>
      <LinkedLogins />
      <DeleteAccount />
    </>
  )
}
