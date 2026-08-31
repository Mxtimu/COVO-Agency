import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import Icon from '../ui/Icon'

export default function BrandCreators() {
  const { session } = useApp()
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    // Get all campaigns for this brand, then affiliate links per campaign
    const campRes = await supabase
      .from('campaigns')
      .select('id, title')
      .eq('brand_id', session?.user?.id)

    const campIds = (campRes.data ?? []).map(c => c.id)
    const campMap = Object.fromEntries((campRes.data ?? []).map(c => [c.id, c.title]))

    if (campIds.length === 0) { setRows([]); setLoading(false); return }

    // creator_profiles is fetched separately: affiliate_links.creator_id is
    // a FK to profiles, so PostgREST cannot embed creator_profiles through
    // it — the same reason campaigns cannot embed brand_profiles.
    const { data: links } = await supabase
      .from('affiliate_links')
      .select('id, creator_id, campaign_id, slug, discount_code, profiles(full_name, email)')
      .in('campaign_id', campIds)

    const creatorIds = [...new Set((links ?? []).map(l => l.creator_id).filter(Boolean))]

    const [{ data: creatorProfiles }, { data: comms }] = await Promise.all([
      creatorIds.length
        ? supabase.from('creator_profiles').select('id, covo_score, is_verified').in('id', creatorIds)
        : Promise.resolve({ data: [] }),
      supabase.from('commissions').select('creator_id, net_commission, status').in('campaign_id', campIds),
    ])

    const scoreMap = Object.fromEntries((creatorProfiles ?? []).map(p => [p.id, p]))

    // Aggregate earnings per creator
    const earningsMap = {}
    for (const c of comms ?? []) {
      if (!earningsMap[c.creator_id]) earningsMap[c.creator_id] = 0
      if (c.status === 'confirmed' || c.status === 'paid') {
        earningsMap[c.creator_id] += Number(c.net_commission)
      }
    }

    setRows((links ?? []).map(l => ({
      ...l,
      campaign_title:  campMap[l.campaign_id] || '—',
      earned:          earningsMap[l.creator_id] || 0,
      creator_profile: scoreMap[l.creator_id] ?? null,
    })))
    setLoading(false)
  }

  if (loading) return <p style={{ color: 'var(--muted)', padding: '1rem' }}>Loading creators…</p>

  return (
    <>
      <div className="page-header"><h2>Creators</h2></div>

      {rows.length === 0 ? (
        <div className="panel-section" style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
          <Icon name="creators" size={40} style={{ marginBottom: '.75rem', opacity: .5 }} />
          <p style={{ fontWeight: 600, color: 'var(--warm-white)', marginBottom: '.5rem' }}>No creators yet</p>
          <p style={{ fontSize: '.875rem' }}>Once COVO assigns creators to your campaigns, they'll appear here.</p>
        </div>
      ) : (
        <div className="panel-section" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
              <thead>
                <tr style={{ background: 'var(--dark3)' }}>
                  {['Creator', 'Campaign', 'COVO Score', 'Affiliate Link', 'Discount Code', 'Earned'].map(h => (
                    <th key={h} style={{ padding: '.75rem 1rem', color: 'var(--muted)', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '.75rem 1rem' }}>
                      <div style={{ fontWeight: 600 }}>{r.profiles?.full_name || '—'}</div>
                      <div style={{ fontSize: '.73rem', color: 'var(--muted)' }}>{r.profiles?.email}</div>
                    </td>
                    <td style={{ padding: '.75rem 1rem', color: 'var(--muted)' }}>{r.campaign_title}</td>
                    <td style={{ padding: '.75rem 1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                        <span style={{ fontWeight: 700 }}>{r.creator_profile?.covo_score ?? '—'}</span>
                        {r.creator_profile?.is_verified && <Icon name="verified" size={13} style={{ color: 'var(--sage)' }} />}
                      </div>
                    </td>
                    <td style={{ padding: '.75rem 1rem' }}>
                      {/* The slug, not a covo.africa/r/ URL — that domain does
                          not serve redirects. The live link is the Edge
                          Function the creator copies; the brand only needs to
                          tell one creator's link from another. */}
                      {r.slug
                        ? <code style={{ fontSize: '.75rem', color: 'var(--lilac)', background: 'rgba(210,184,242,.08)', padding: '.15rem .45rem', borderRadius: 5 }}>{r.slug}</code>
                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '.75rem 1rem' }}>
                      {r.discount_code
                        ? <code style={{ fontSize: '.75rem', color: 'var(--sage)', background: 'rgba(195,206,148,.08)', padding: '.15rem .45rem', borderRadius: 5 }}>{r.discount_code}</code>
                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '.75rem 1rem', fontWeight: 700, color: r.earned > 0 ? 'var(--warning)' : 'var(--muted)' }}>
                      R{r.earned.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
