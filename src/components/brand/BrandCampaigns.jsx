import { useState, useEffect, Fragment } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import CampaignProducts from './CampaignProducts'
import Icon from '../ui/Icon'

const STATUS_STYLE = {
  pending:  { bg: 'rgba(245,158,11,.12)',  color: 'var(--warning)' },
  active:   { bg: 'rgba(16,185,129,.12)',  color: 'var(--success)' },
  paused:   { bg: 'rgba(245,158,11,.12)',  color: 'var(--warning)' },
  closed:   { bg: 'rgba(193,183,170,.08)', color: 'var(--muted)'   },
}

const RETURN_WINDOWS = [14, 30]

export default function BrandCampaigns() {
  const { session } = useApp()
  const [campaigns, setCampaigns] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [creating,  setCreating]  = useState(false)
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState('')
  const [expanded,  setExpanded]  = useState(null)
  const [form, setForm] = useState({ title: '', description: '', commission_rate: '', return_window_days: 14 })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('campaigns')
      .select('id, title, description, status, commission_rate, return_window_days, created_at')
      .eq('brand_id', session?.user?.id)
      .order('created_at', { ascending: false })
    setCampaigns(data ?? [])
    setLoading(false)
  }

  const setF = k => e => { setError(''); setForm(f => ({ ...f, [k]: e.target.value })) }

  async function createCampaign(e) {
    e.preventDefault()
    if (!form.title.trim())                       return setError('Please enter a campaign title.')
    if (!form.commission_rate || isNaN(Number(form.commission_rate))) return setError('Please enter a valid commission rate.')
    if (Number(form.commission_rate) < 1 || Number(form.commission_rate) > 80) return setError('Commission rate must be between 1% and 80%.')

    setBusy(true); setError('')
    const { error } = await supabase.from('campaigns').insert({
      brand_id:            session.user.id,
      title:               form.title.trim(),
      description:         form.description.trim() || null,
      commission_rate:     Number(form.commission_rate) / 100,
      return_window_days:  Number(form.return_window_days),
      status:              'pending',
    })
    setBusy(false)
    if (error) return setError(error.message)
    setForm({ title: '', description: '', commission_rate: '', return_window_days: 14 })
    setCreating(false)
    load()
  }

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <h2>Campaigns</h2>
        <button
          onClick={() => { setCreating(c => !c); setError('') }}
          style={{ background: 'var(--gradient)', border: 'none', color: 'white', padding: '.5rem 1.25rem', borderRadius: 9, cursor: 'pointer', fontWeight: 700, fontFamily: 'var(--font-sans)', fontSize: '.85rem' }}
        >
          {creating ? <><Icon name="close" size={14} /> Cancel</> : <><Icon name="add" size={14} /> New Campaign</>}
        </button>
      </div>

      {/* CREATE FORM */}
      {creating && (
        <div className="panel-section" style={{ marginBottom: '1.5rem', borderLeft: '3px solid var(--sage)' }}>
          <h3 style={{ marginBottom: '1.25rem' }}>New Campaign</h3>
          {error && <div className="error-banner">{error}</div>}
          <form onSubmit={createCampaign}>
            <div className="form-group">
              <label>Campaign title</label>
              <input type="text" placeholder="e.g. Summer Collection Launch" value={form.title} onChange={setF('title')} />
            </div>
            <div className="form-group">
              <label>Description <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
              <textarea
                placeholder="What this campaign is about, who you're targeting, what creators should know..."
                value={form.description}
                onChange={setF('description')}
                style={{ width: '100%', minHeight: 90, padding: '.65rem .9rem', background: 'var(--dark3)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--warm-white)', fontFamily: 'var(--font-sans)', fontSize: '.87rem', lineHeight: 1.6, resize: 'vertical' }}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Commission rate (%)</label>
                <input type="number" placeholder="e.g. 15" min="1" max="80" value={form.commission_rate} onChange={setF('commission_rate')} />
              </div>
              <div className="form-group">
                <label>Return window (days)</label>
                <select
                  value={form.return_window_days}
                  onChange={e => setForm(f => ({ ...f, return_window_days: Number(e.target.value) }))}
                  style={{ width: '100%', padding: '.65rem .9rem', background: 'var(--dark3)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--warm-white)', fontFamily: 'var(--font-sans)', fontSize: '.87rem' }}
                >
                  {RETURN_WINDOWS.map(w => <option key={w} value={w}>{w} days</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '.65rem', marginTop: '.5rem' }}>
              <button type="submit" className="btn-full" disabled={busy} style={{ flex: 2 }}>{busy ? 'Submitting…' : 'Submit for review →'}</button>
            </div>
            <p style={{ fontSize: '.76rem', color: 'var(--muted)', marginTop: '.65rem', textAlign: 'center' }}>
              Campaigns are reviewed by the COVO team before going live. You'll be notified once approved.
            </p>
          </form>
        </div>
      )}

      {/* CAMPAIGNS TABLE */}
      <div className="panel-section" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ padding: '2rem', color: 'var(--muted)' }}>Loading campaigns…</p>
        ) : campaigns.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
            <Icon name="campaigns" size={40} style={{ marginBottom: '.75rem', opacity: .5 }} />
            <p style={{ marginBottom: '.5rem', fontWeight: 600, color: 'var(--warm-white)' }}>No campaigns yet</p>
            <p style={{ fontSize: '.875rem' }}>Create your first campaign to start working with creators.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
              <thead>
                <tr style={{ background: 'var(--dark3)' }}>
                  {['Campaign', 'Status', 'Commission', 'Return Window', 'Created', ''].map(h => (
                    <th key={h} style={{ padding: '.75rem 1rem', color: 'var(--muted)', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => {
                  const st   = STATUS_STYLE[c.status] || STATUS_STYLE.pending
                  const open = expanded === c.id
                  return (
                    <Fragment key={c.id}>
                      <tr style={{ borderBottom: open ? 'none' : '1px solid var(--border)' }}>
                        <td style={{ padding: '.75rem 1rem', fontWeight: 600 }}>{c.title}</td>
                        <td style={{ padding: '.75rem 1rem' }}>
                          <span style={{ padding: '.2rem .65rem', borderRadius: 100, fontSize: '.72rem', fontWeight: 600, background: st.bg, color: st.color }}>{c.status}</span>
                        </td>
                        <td style={{ padding: '.75rem 1rem', fontWeight: 700, color: 'var(--sage)' }}>{(Number(c.commission_rate) * 100).toFixed(0)}%</td>
                        <td style={{ padding: '.75rem 1rem', color: 'var(--muted)' }}>{c.return_window_days} days</td>
                        <td style={{ padding: '.75rem 1rem', color: 'var(--muted)', fontSize: '.78rem' }}>{new Date(c.created_at).toLocaleDateString('en-ZA')}</td>
                        <td style={{ padding: '.75rem 1rem' }}>
                          <button
                            onClick={() => setExpanded(open ? null : c.id)}
                            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--sage)', padding: '.2rem .6rem', borderRadius: 6, cursor: 'pointer', fontSize: '.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}
                          >
                            {open ? 'Hide products' : 'Products'}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <td colSpan={6} style={{ padding: '0 1rem 1rem', background: 'var(--dark3)' }}>
                            <CampaignProducts campaignId={c.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
