import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import Icon from '../ui/Icon'

const FILTERS = ['all', 'available', 'applied', 'approved']

export default function Campaigns({ showToast }) {
  const { session } = useApp()
  const [campaigns,    setCampaigns]    = useState([])
  const [applications, setApplications] = useState({})   // campaign_id → status
  const [filter,       setFilter]       = useState('all')
  const [loading,      setLoading]      = useState(true)
  const [busy,         setBusy]         = useState(null)
  const [error,        setError]        = useState('')

  useEffect(() => { load() }, [session?.user?.id])

  async function load() {
    if (!session?.user?.id) return
    setLoading(true)

    // brand_profiles is fetched separately rather than embedded: campaigns.brand_id
    // is a FK to profiles, not brand_profiles, so PostgREST cannot join them.
    const [{ data: camps, error: campError }, { data: apps }] = await Promise.all([
      supabase
        .from('campaigns')
        .select('id, title, description, commission_rate, return_window_days, brand_id')
        .eq('status', 'active')
        .order('created_at', { ascending: false }),
      supabase
        .from('campaign_applications')
        .select('campaign_id, status')
        .eq('creator_id', session.user.id),
    ])

    if (campError) {
      setError(campError.message)
      setLoading(false)
      return
    }

    const brandIds = [...new Set((camps ?? []).map(c => c.brand_id))]
    let brands = {}
    if (brandIds.length) {
      const { data: bp } = await supabase
        .from('brand_profiles').select('id, company_name, industry').in('id', brandIds)
      brands = Object.fromEntries((bp ?? []).map(b => [b.id, b]))
    }

    setCampaigns((camps ?? []).map(c => ({ ...c, brand: brands[c.brand_id] ?? null })))
    setApplications(Object.fromEntries((apps ?? []).map(a => [a.campaign_id, a.status])))
    setLoading(false)
  }

  async function apply(campaign) {
    setBusy(campaign.id)
    const { error } = await supabase.from('campaign_applications').insert({
      creator_id:  session.user.id,
      campaign_id: campaign.id,
      status:      'pending',
    })
    setBusy(null)

    if (error) {
      // Unique violation — they already applied, so reflect that rather than error.
      if (error.code === '23505') {
        setApplications(prev => ({ ...prev, [campaign.id]: 'pending' }))
        return showToast?.('You have already applied to this campaign.')
      }
      return showToast?.(error.message)
    }

    setApplications(prev => ({ ...prev, [campaign.id]: 'pending' }))
    showToast?.('Application submitted — the COVO team will review it shortly.')
  }

  const visible = campaigns.filter(c => {
    const status = applications[c.id]
    if (filter === 'available') return !status
    if (filter === 'applied')   return status === 'pending'
    if (filter === 'approved')  return status === 'approved'
    return true
  })

  if (loading) return <p style={{ color: 'var(--muted)' }}>Loading campaigns…</p>

  return (
    <>
      <div className="page-header">
        <h2>Campaigns</h2>
        <div className="filter-pills">
          {FILTERS.map(f => (
            <button key={f} className={`filter-pill ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#FCA5A5', padding: '.7rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '.82rem' }}>
          {error}
        </div>
      )}

      {!error && campaigns.length === 0 && (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
          <Icon name="search" size={40} style={{ marginBottom: '.75rem', opacity: .5 }} />
          <p style={{ marginBottom: '.5rem', fontWeight: 600, color: 'var(--warm-white)' }}>No live campaigns yet</p>
          <p style={{ fontSize: '.875rem' }}>New brand campaigns appear here once they go live.</p>
        </div>
      )}

      <div className="campaigns-grid">
        {visible.map(c => {
          const brand  = c.brand
          const status = applications[c.id]
          const rate   = (Number(c.commission_rate) * 100).toFixed(0)

          return (
            <div className="campaign-card" key={c.id}>
              <div className="campaign-banner" style={{ background: 'var(--gradient)' }}>
                {(brand?.company_name ?? 'C').charAt(0).toUpperCase()}
              </div>
              <div className="campaign-body">
                <div className="campaign-brand">{brand?.company_name ?? 'Brand'}</div>
                <div className="campaign-title">{c.title}</div>
                <div className="campaign-meta">
                  <div className="meta-chip commission"><Icon name="money" size={13} /> {rate}% commission</div>
                  <div className="meta-chip"><Icon name="clock" size={13} /> {c.return_window_days}-day window</div>
                  {brand?.industry && <div className="meta-chip"><Icon name="tag" size={13} /> {brand.industry}</div>}
                </div>
                <div className="campaign-footer">
                  <span className={`status-badge ${status ?? 'available'}`}>
                    {status === 'approved' ? 'Approved'
                      : status === 'pending' ? 'Under review'
                      : status === 'rejected' ? 'Not accepted'
                      : 'Available'}
                  </span>
                  <button
                    className={`btn-sm ${!status ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderRadius: 8 }}
                    onClick={() => apply(c)}
                    disabled={!!status || busy === c.id}
                  >
                    {busy === c.id ? 'Applying…'
                      : status === 'approved' ? 'Joined'
                      : status === 'pending' ? 'Awaiting review'
                      : status === 'rejected' ? 'Not accepted'
                      : 'Apply Now'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
