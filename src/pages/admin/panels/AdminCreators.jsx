import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import Icon from '../../../components/ui/Icon'

export default function AdminCreators() {
  const [creators, setCreators] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [editing,  setEditing]  = useState({}) // { [id]: { score, status } }

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

  async function setStatus(id, status) {
    await supabase.from('profiles').update({ status }).eq('id', id)
    setCreators(prev => prev.map(c => c.id === id ? { ...c, status } : c))
  }

  async function saveScore(id, score) {
    const val = Math.min(100, Math.max(0, Number(score)))
    await supabase.from('creator_profiles').upsert({
      id, covo_score: val, covo_score_updated_at: new Date().toISOString(),
      is_verified: val >= 50,
    })
    setCreators(prev => prev.map(c => {
      if (c.id !== id) return c
      const profile = cp(c) ?? {}
      const updated = { ...profile, covo_score: val, is_verified: val >= 50 }
      return { ...c, creator_profiles: updated }
    }))
    setEditing(e => { const n = { ...e }; delete n[id]; return n })
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
                const isEditing = editing[c.id] !== undefined

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
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                          <input type="number" min="0" max="100"
                            value={editing[c.id]}
                            onChange={e => setEditing(prev => ({ ...prev, [c.id]: e.target.value }))}
                            style={{ width: 60, padding: '.25rem .4rem', background: 'var(--dark3)', border: '1px solid var(--sage)', borderRadius: 6, color: 'var(--warm-white)', fontSize: '.84rem' }}
                          />
                          <button onClick={() => saveScore(c.id, editing[c.id])}
                            style={{ background: 'var(--sage)', border: 'none', color: 'var(--ink-deep)', padding: '.25rem .6rem', borderRadius: 6, cursor: 'pointer', fontSize: '.75rem', fontWeight: 700 }}>
                            Save
                          </button>
                          <button onClick={() => setEditing(e => { const n={...e}; delete n[c.id]; return n })}
                            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', padding: '.25rem .5rem', borderRadius: 6, cursor: 'pointer', fontSize: '.75rem' }}>
                            <Icon name="close" size={14} />
                          </button>
                        </div>
                      ) : (
                        <span onClick={() => setEditing(e => ({ ...e, [c.id]: score }))}
                          style={{ cursor: 'pointer', color: score >= 50 ? 'var(--sage)' : 'var(--warm-white)', fontWeight: 700, borderBottom: '1px dashed var(--border)' }}
                          title="Click to edit">
                          {score}/100
                        </span>
                      )}
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
