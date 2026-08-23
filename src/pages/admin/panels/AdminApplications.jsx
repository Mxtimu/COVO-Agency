import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import Icon from '../../../components/ui/Icon'

const FILTERS = ['pending', 'approved', 'rejected', 'all']

export default function AdminApplications() {
  const [apps,    setApps]    = useState([])
  const [filter,  setFilter]  = useState('pending')
  const [loading, setLoading] = useState(true)
  const [busy,    setBusy]    = useState(null)
  const [error,   setError]   = useState('')

  useEffect(() => { load() }, [filter])

  async function load() {
    setLoading(true)
    // The brand's company_name cannot be embedded here: campaigns.brand_id is a
    // FK to profiles, so PostgREST resolves the alias to profiles and fails on
    // the missing column. Fetch brand_profiles in a second pass instead.
    let query = supabase
      .from('campaign_applications')
      .select(`
        id, status, created_at, reviewed_at, campaign_id, creator_id,
        profiles:creator_id(full_name, email, creator_profiles(covo_score, is_verified, follower_count, niche)),
        campaigns:campaign_id(title, commission_rate, brand_id)
      `)
      .order('created_at', { ascending: false })

    if (filter !== 'all') query = query.eq('status', filter)

    const { data, error } = await query
    if (error) {
      setError(error.message)
      setApps([])
      setLoading(false)
      return
    }

    const one = v => (Array.isArray(v) ? v[0] : v)
    const brandIds = [...new Set((data ?? []).map(a => one(a.campaigns)?.brand_id).filter(Boolean))]

    let brands = {}
    if (brandIds.length) {
      const { data: bp } = await supabase
        .from('brand_profiles').select('id, company_name').in('id', brandIds)
      brands = Object.fromEntries((bp ?? []).map(b => [b.id, b]))
    }

    setApps((data ?? []).map(a => ({ ...a, brand: brands[one(a.campaigns)?.brand_id] ?? null })))
    setError('')
    setLoading(false)
  }

  // Approval is what mints the affiliate links. The Edge Function runs with
  // the service role, so it can write links the creator could not create for
  // themselves — that gating is the whole point of the admin review.
  async function approve(app) {
    setBusy(app.id); setError('')

    const { data: { session } } = await supabase.auth.getSession()
    const { data, error: fnError } = await supabase.functions.invoke('generate-affiliate-assets', {
      body: { creator_id: app.creator_id, campaign_id: app.campaign_id },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })

    if (fnError || data?.error) {
      setBusy(null)
      return setError(data?.error ?? fnError.message ?? 'Could not generate affiliate links.')
    }

    const { error: updateError } = await supabase
      .from('campaign_applications')
      .update({
        status:      'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: session?.user?.id,
      })
      .eq('id', app.id)

    if (updateError) { setBusy(null); return setError(updateError.message) }

    // Mirror into joined_campaign_ids, which the creator dashboard reads.
    const { data: cp } = await supabase
      .from('creator_profiles').select('joined_campaign_ids').eq('id', app.creator_id).single()

    const joined = new Set(cp?.joined_campaign_ids ?? [])
    joined.add(app.campaign_id)
    await supabase.from('creator_profiles')
      .upsert({ id: app.creator_id, joined_campaign_ids: [...joined] })

    setBusy(null)
    load()
  }

  async function reject(app) {
    if (!confirm('Reject this application? The creator will see it as not accepted.')) return
    setBusy(app.id); setError('')

    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase
      .from('campaign_applications')
      .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: session?.user?.id })
      .eq('id', app.id)

    setBusy(null)
    if (error) return setError(error.message)
    load()
  }

  const one = v => (Array.isArray(v) ? v[0] : v)

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <h2>Applications</h2>
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

      <div className="panel-section" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <p style={{ padding: '2rem', color: 'var(--muted)' }}>Loading applications…</p>
        ) : apps.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)' }}>
            <Icon name="applications" size={40} style={{ marginBottom: '.75rem', opacity: .5 }} />
            <p style={{ fontWeight: 600, color: 'var(--warm-white)' }}>
              No {filter === 'all' ? '' : filter} applications
            </p>
            <p style={{ fontSize: '.875rem' }}>Creator applications to live campaigns appear here for review.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
              <thead>
                <tr style={{ background: 'var(--dark3)', textAlign: 'left' }}>
                  {['Creator', 'COVO Score', 'Campaign', 'Brand', 'Commission', 'Applied', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '.75rem 1rem', color: 'var(--muted)', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apps.map(a => {
                  const creator  = one(a.profiles)
                  const cp       = one(creator?.creator_profiles)
                  const campaign = one(a.campaigns)
                  const brand    = a.brand
                  const score    = cp?.covo_score ?? 0

                  return (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '.75rem 1rem' }}>
                        <div style={{ fontWeight: 600 }}>{creator?.full_name || '—'}</div>
                        <div style={{ color: 'var(--muted)', fontSize: '.74rem' }}>{creator?.email}</div>
                      </td>
                      <td style={{ padding: '.75rem 1rem' }}>
                        <span style={{
                          fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                          color: score >= 70 ? 'var(--success)' : score >= 40 ? 'var(--warning)' : 'var(--muted)',
                        }}>{score}</span>
                        {cp?.is_verified && <Icon name="verified" size={13} style={{ marginLeft: '.35rem', verticalAlign: 'text-bottom' }} />}
                      </td>
                      <td style={{ padding: '.75rem 1rem', fontWeight: 600, maxWidth: 180 }}>{campaign?.title || '—'}</td>
                      <td style={{ padding: '.75rem 1rem', color: 'var(--muted)' }}>{brand?.company_name || '—'}</td>
                      <td style={{ padding: '.75rem 1rem', color: 'var(--sage)', fontWeight: 700 }}>
                        {campaign ? `${(Number(campaign.commission_rate) * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td style={{ padding: '.75rem 1rem', color: 'var(--muted)', fontSize: '.78rem', whiteSpace: 'nowrap' }}>
                        {new Date(a.created_at).toLocaleDateString('en-ZA')}
                      </td>
                      <td style={{ padding: '.75rem 1rem' }}>
                        <span className={`status-badge ${a.status}`}>{a.status}</span>
                      </td>
                      <td style={{ padding: '.75rem 1rem' }}>
                        {a.status === 'pending' ? (
                          <div style={{ display: 'flex', gap: '.4rem' }}>
                            <button onClick={() => approve(a)} disabled={busy === a.id}
                              style={{ background: 'rgba(16,185,129,.12)', border: 'none', color: 'var(--success)', padding: '.25rem .6rem', borderRadius: 6, cursor: busy === a.id ? 'wait' : 'pointer', fontSize: '.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              {busy === a.id ? 'Approving…' : 'Approve'}
                            </button>
                            <button onClick={() => reject(a)} disabled={busy === a.id}
                              style={{ background: 'rgba(239,68,68,.12)', border: 'none', color: '#FCA5A5', padding: '.25rem .6rem', borderRadius: 6, cursor: busy === a.id ? 'wait' : 'pointer', fontSize: '.72rem', fontWeight: 600 }}>
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: '.74rem' }}>
                            {a.reviewed_at ? new Date(a.reviewed_at).toLocaleDateString('en-ZA') : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
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
