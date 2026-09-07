import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import Icon from '../../../components/ui/Icon'

export default function AdminCreators() {
  const [creators, setCreators] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [busy,     setBusy]     = useState(null) // { [id]: { score, status } }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, status, created_at, creator_profiles(covo_score, niches, guardrail_acknowledged, is_verified)')
      .eq('role', 'creator')
      .order('created_at', { ascending: false })
    setCreators(data ?? [])
    setLoading(false)
  }

  function cp(c) {
    const raw = c.creator_profiles
    return Array.isArray(raw) ? raw[0] : raw
  }

  // The local state update used to happen regardless of whether the write
  // landed, so an RLS refusal or a dropped connection showed the admin an
  // approved creator who was still pending in the database.
  async function setStatus(id, status) {
    const { error } = await supabase.from('profiles').update({ status }).eq('id', id)
    if (error) return alert(`Could not set status to ${status}: ${error.message}`)
    setCreators(prev => prev.map(c => c.id === id ? { ...c, status } : c))
  }

  // The score is derived from the creator's actual clicks, sales, order values
  // and disputes. A hand-typed number would be overwritten by the next
  // commission anyway, so the admin action is "recalculate", not "set".
  async function recalcScore(id) {
    setBusy(id)
    const { data, error } = await supabase.rpc('refresh_covo_score', { p_creator: id })
    setBusy(null)
    if (error) return alert(`Could not recalculate: ${error.message}`)

    setCreators(prev => prev.map(c => {
      if (c.id !== id) return c
      return { ...c, creator_profiles: { ...(cp(c) ?? {}), covo_score: data } }
    }))
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Loading creators…</p>

  return (
    <>
      <div className="page-header">
        <h2>Creators <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '.85rem' }}>({creators.length})</span></h2>
      </div>

      <div className="panel-section" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
            <thead>
              <tr style={{ background: 'var(--dark3)', textAlign: 'left' }}>
                {['Creator','Email','Status','COVO Score','Verified','Guardrail','Actions'].map(h => (
                  <th key={h} style={{ padding: '.75rem 1rem', color: 'var(--muted)', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {creators.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No creators yet.</td></tr>
              )}
              {creators.map(c => {
                const profile   = cp(c)
                const score     = profile?.covo_score ?? 0
                const verified  = profile?.is_verified
                const guardrail = profile?.guardrail_acknowledged

                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '.75rem 1rem', fontWeight: 600 }}>{c.full_name || '—'}</td>
                    <td style={{ padding: '.75rem 1rem', color: 'var(--muted)' }}>{c.email}</td>
                    <td style={{ padding: '.75rem 1rem' }}>
                      <span style={{
                        padding: '.2rem .6rem', borderRadius: 100, fontSize: '.72rem', fontWeight: 600,
                        background: c.status === 'approved' ? 'rgba(16,185,129,.12)' : c.status === 'suspended' ? 'rgba(239,68,68,.12)' : 'rgba(245,158,11,.12)',
                        color: c.status === 'approved' ? 'var(--success)' : c.status === 'suspended' ? '#FCA5A5' : 'var(--warning)',
                      }}>{c.status}</span>
                    </td>
                    <td style={{ padding: '.75rem 1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        <span style={{ color: score >= 50 ? 'var(--sage)' : score > 0 ? 'var(--warm-white)' : 'var(--muted)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {score > 0 ? `${score}/100` : 'unproven'}
                        </span>
                        <button onClick={() => recalcScore(c.id)} disabled={busy === c.id}
                          title="Recalculate from this creator's clicks, sales and disputes"
                          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '.15rem .5rem', borderRadius: 6, cursor: busy === c.id ? 'wait' : 'pointer', fontSize: '.7rem' }}>
                          {busy === c.id ? '…' : 'Recalc'}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '.75rem 1rem', color: verified ? 'var(--sage)' : 'var(--muted)' }}>{verified ? <><Icon name="check" size={14} /> Yes</> : 'No'}</td>
                    <td style={{ padding: '.75rem 1rem', color: guardrail ? 'var(--success)' : 'var(--muted)' }}>{guardrail ? <Icon name="check" size={15} /> : <Icon name="close" size={15} />}</td>
                    <td style={{ padding: '.75rem 1rem' }}>
                      <div style={{ display: 'flex', gap: '.4rem' }}>
                        {c.status !== 'approved' && (
                          <button onClick={() => setStatus(c.id, 'approved')}
                            style={{ background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.25)', color: 'var(--success)', padding: '.25rem .6rem', borderRadius: 6, cursor: 'pointer', fontSize: '.72rem', fontWeight: 600 }}>
                            Approve
                          </button>
                        )}
                        {c.status !== 'suspended' && (
                          <button onClick={() => setStatus(c.id, 'suspended')}
                            style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', color: '#FCA5A5', padding: '.25rem .6rem', borderRadius: 6, cursor: 'pointer', fontSize: '.72rem' }}>
                            Suspend
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
