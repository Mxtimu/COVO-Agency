import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import Icon from '../ui/Icon'

export default function BrandOverview() {
  const { session, profile } = useApp()
  const [stats,   setStats]   = useState({ campaigns: 0, creators: 0, clicks: 0, commissions: 0 })
  const [recent,  setRecent]  = useState([])
  const [loading, setLoading] = useState(true)

  const bp = Array.isArray(profile?.brand_profiles) ? profile.brand_profiles[0] : profile?.brand_profiles
  const company = bp?.company_name || profile?.full_name || 'Brand'

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const uid = session?.user?.id
    if (!uid) { setLoading(false); return }

    const [campRes, commRes] = await Promise.all([
      supabase.from('campaigns').select('id, title, status').eq('brand_id', uid),
      supabase.from('commissions')
        .select('id, net_commission, status, created_at, profiles(full_name)')
        .in('campaign_id',
          await supabase.from('campaigns').select('id').eq('brand_id', uid)
            .then(r => (r.data ?? []).map(c => c.id))
        )
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    const campaigns = campRes.data ?? []
    const comms     = commRes.data ?? []

    const totalComm = comms.reduce((s, c) => s + Number(c.net_commission || 0), 0)

    setStats({
      campaigns:   campaigns.length,
      creators:    0,
      clicks:      0,
      commissions: totalComm,
    })
    setRecent(comms)
    setLoading(false)
  }

  const STATS = [
    { label: 'Active Campaigns', value: stats.campaigns, color: 'var(--sage)' },
    { label: 'Total Clicks',     value: stats.clicks,     color: 'var(--lilac)' },
    { label: 'Commissions Owed', value: `R${stats.commissions.toFixed(2)}`, color: 'var(--warning)' },
  ]

  const STATUS_COLOR = {
    pending:   'var(--warning)',
    confirmed: 'var(--success)',
    paid:      'var(--muted)',
    held:      '#FCA5A5',
    denied:    '#FCA5A5',
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Welcome back, {company}</h2>
          <p style={{ color: 'var(--muted)', fontSize: '.875rem', marginTop: '.25rem' }}>Here's what's happening with your campaigns.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        {STATS.map(s => (
          <div key={s.label} className="panel-section" style={{ padding: '1.25rem 1.5rem' }}>
            <div style={{ fontSize: '.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.5rem' }}>{s.label}</div>
            <div style={{ fontSize: '1.9rem', fontWeight: 800, color: s.color }}>{loading ? '—' : s.value}</div>
          </div>
        ))}
      </div>

      <div className="panel-section">
        <h3 style={{ marginBottom: '1rem' }}>Recent Commissions</h3>
        {loading ? (
          <p style={{ color: 'var(--muted)', fontSize: '.875rem' }}>Loading…</p>
        ) : recent.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--muted)' }}>
            <Icon name="campaigns" size={34} style={{ marginBottom: '.75rem', opacity: .5 }} />
            <p style={{ fontSize: '.875rem' }}>No commissions yet. Launch a campaign to get started.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {recent.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.65rem 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: '.875rem' }}>{c.profiles?.full_name || 'Creator'}</div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, color: 'var(--success)' }}>R{Number(c.net_commission).toFixed(2)}</span>
                  <span style={{ fontSize: '.72rem', padding: '.2rem .6rem', borderRadius: 100, background: 'rgba(0,0,0,.2)', color: STATUS_COLOR[c.status] || 'var(--muted)' }}>
                    {c.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel-section" style={{ marginTop: '1rem' }}>
        <h3 style={{ marginBottom: '.75rem' }}>Quick actions</h3>
        <div style={{ display: 'flex', gap: '.65rem', flexWrap: 'wrap' }}>
          <div style={{ padding: '.75rem 1.25rem', background: 'rgba(195,206,148,.08)', border: '1px solid rgba(195,206,148,.2)', borderRadius: 10, fontSize: '.84rem', color: 'var(--sage)', cursor: 'pointer', fontWeight: 600 }}>
            + Create campaign
          </div>
          <div style={{ padding: '.75rem 1.25rem', background: 'var(--dark3)', border: '1px solid var(--border)', borderRadius: 10, fontSize: '.84rem', color: 'var(--warm-white)', cursor: 'pointer' }}>
            Add escrow funds
          </div>
          <div style={{ padding: '.75rem 1.25rem', background: 'var(--dark3)', border: '1px solid var(--border)', borderRadius: 10, fontSize: '.84rem', color: 'var(--warm-white)', cursor: 'pointer' }}>
            View creators
          </div>
        </div>
      </div>
    </>
  )
}
