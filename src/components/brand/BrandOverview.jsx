import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import Icon from '../ui/Icon'

export default function BrandOverview({ showPanel }) {
  const { session, profile } = useApp()
  const [stats,   setStats]   = useState({ campaigns: 0, creators: 0, clicks: 0, owed: 0 })
  const [recent,  setRecent]  = useState([])
  const [loading, setLoading] = useState(true)

  const bp = Array.isArray(profile?.brand_profiles) ? profile.brand_profiles[0] : profile?.brand_profiles
  const company = bp?.company_name || profile?.full_name || 'Brand'

  useEffect(() => { load() }, [session?.user?.id])

  async function load() {
    setLoading(true)
    const uid = session?.user?.id
    if (!uid) { setLoading(false); return }

    // The campaign ids gate every other query, so this one is awaited on its
    // own rather than hidden inside a Promise.all that cannot actually run in
    // parallel around it.
    const { data: campaigns } = await supabase
      .from('campaigns').select('id, title, status').eq('brand_id', uid)

    const campIds = (campaigns ?? []).map(c => c.id)

    if (!campIds.length) {
      setStats({ campaigns: 0, creators: 0, clicks: 0, owed: 0 })
      setRecent([])
      setLoading(false)
      return
    }

    const [{ count: clicks }, { data: links }, { data: owedRows }, { data: comms }] = await Promise.all([
      // head:true — the count comes back in a header, so no rows cross the wire.
      supabase.from('clicks').select('id', { count: 'exact', head: true }).in('campaign_id', campIds),
      supabase.from('affiliate_links').select('creator_id').in('campaign_id', campIds),
      // Owed is what this brand still has to pay: 'paid' is already settled
      // and 'denied' never becomes payable, so summing every status — which
      // is what this tile used to do — overstated the liability permanently.
      supabase.from('commissions').select('net_commission')
        .in('campaign_id', campIds).in('status', ['pending', 'confirmed']),
      supabase.from('commissions')
        .select('id, net_commission, status, created_at, profiles(full_name)')
        .in('campaign_id', campIds)
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    setStats({
      campaigns: (campaigns ?? []).filter(c => c.status === 'active').length,
      creators:  new Set((links ?? []).map(l => l.creator_id)).size,
      clicks:    clicks ?? 0,
      owed:      (owedRows ?? []).reduce((s, c) => s + Number(c.net_commission || 0), 0),
    })
    setRecent(comms ?? [])
    setLoading(false)
  }

  const STATS = [
    { label: 'Active Campaigns', value: stats.campaigns, color: 'var(--sage)' },
    { label: 'Creators Working With You', value: stats.creators, color: 'var(--lilac)' },
    { label: 'Total Clicks',     value: stats.clicks.toLocaleString('en-ZA'), color: 'var(--tan)' },
    { label: 'Commissions Owed', value: `R${stats.owed.toFixed(2)}`, color: 'var(--warning)' },
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
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
        {/* These were divs with cursor:pointer and no handler — they looked
            clickable and did nothing. Now they are buttons that navigate. */}
        <div style={{ display: 'flex', gap: '.65rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => showPanel?.('campaigns')}
            style={{ padding: '.75rem 1.25rem', background: 'rgba(195,206,148,.08)', border: '1px solid rgba(195,206,148,.2)', borderRadius: 10, fontSize: '.84rem', color: 'var(--sage)', cursor: 'pointer', fontWeight: 600, fontFamily: 'var(--font-sans)' }}
          >
            + Create campaign
          </button>
          <button
            onClick={() => showPanel?.('payments')}
            style={{ padding: '.75rem 1.25rem', background: 'var(--dark3)', border: '1px solid var(--border)', borderRadius: 10, fontSize: '.84rem', color: 'var(--warm-white)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
          >
            Add escrow funds
          </button>
          <button
            onClick={() => showPanel?.('creators')}
            style={{ padding: '.75rem 1.25rem', background: 'var(--dark3)', border: '1px solid var(--border)', borderRadius: 10, fontSize: '.84rem', color: 'var(--warm-white)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
          >
            View creators
          </button>
        </div>
      </div>
    </>
  )
}
