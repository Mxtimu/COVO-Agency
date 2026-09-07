import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { useApp } from '../../../context/AppContext'

const TYPE_LABEL = {
  commission_denial:  'Commission Denial',
  unconfirmed_sale:   'Unconfirmed Sale',
  brand_safety:       'Brand Safety',
  other:              'Other',
}

export default function AdminDisputes() {
  const { session }    = useApp()
  const [disputes, setDisputes] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [resolving, setResolving] = useState({}) // { [id]: notes }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('disputes')
      .select('id, type, description, status, created_at, resolution_notes, profiles!raised_by(full_name, email), campaigns(title)')
      .order('created_at', { ascending: false })
    setDisputes(data ?? [])
    setLoading(false)
  }

  // A dispute is a money decision — it feeds the reliability component of the
  // creator's COVO Score and can end with a commission denied. Resolving one
  // used to update the screen whether or not the write landed, so a failure
  // left the dispute open in the database while the admin believed it closed
  // and moved on. The resolution notes went with it.
  async function resolve(id, status) {
    const notes = resolving[id] || ''
    const { error } = await supabase.from('disputes').update({
      status,
      resolved_by:      session?.user?.id,
      resolution_notes: notes,
      updated_at:       new Date().toISOString(),
    }).eq('id', id)

    if (error) return alert(`Could not ${status === 'resolved' ? 'resolve' : 'dismiss'} this dispute: ${error.message}\n\nYour notes have been kept — try again.`)

    setDisputes(prev => prev.map(d => d.id === id ? { ...d, status, resolution_notes: notes } : d))
    setResolving(r => { const n = { ...r }; delete n[id]; return n })
  }

  async function setUnderReview(id) {
    const { error } = await supabase.from('disputes').update({ status: 'under_review' }).eq('id', id)
    if (error) return alert(`Could not mark this dispute under review: ${error.message}`)
    setDisputes(prev => prev.map(d => d.id === id ? { ...d, status: 'under_review' } : d))
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Loading disputes…</p>

  const open   = disputes.filter(d => d.status === 'open' || d.status === 'under_review')
  const closed = disputes.filter(d => d.status === 'resolved' || d.status === 'dismissed')

  return (
    <>
      <div className="page-header">
        <h2>Disputes <span style={{ color: 'var(--warning)', fontWeight: 400, fontSize: '.85rem' }}>({open.length} open)</span></h2>
      </div>

      {open.map(d => (
        <div key={d.id} className="panel-section" style={{ marginBottom: '1rem', borderLeft: `3px solid ${d.status === 'under_review' ? 'var(--warning)' : 'var(--danger)'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.75rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.9rem' }}>{TYPE_LABEL[d.type]}</div>
              <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.2rem' }}>
                {d.profiles?.full_name} · {d.campaigns?.title || 'No campaign'} · {new Date(d.created_at).toLocaleDateString('en-ZA')}
              </div>
            </div>
            <span style={{
              padding: '.2rem .65rem', borderRadius: 100, fontSize: '.72rem', fontWeight: 600, alignSelf: 'flex-start',
              background: d.status === 'under_review' ? 'rgba(245,158,11,.12)' : 'rgba(239,68,68,.12)',
              color:      d.status === 'under_review' ? 'var(--warning)' : '#FCA5A5',
            }}>{d.status.replace('_', ' ')}</span>
          </div>

          <p style={{ fontSize: '.85rem', color: 'var(--tan)', lineHeight: 1.65, marginBottom: '1rem' }}>{d.description}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            <textarea
              placeholder="Resolution notes (required before resolving or dismissing)…"
              value={resolving[d.id] ?? ''}
              onChange={e => setResolving(r => ({ ...r, [d.id]: e.target.value }))}
              style={{ width: '100%', padding: '.6rem .85rem', background: 'var(--dark3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--warm-white)', fontSize: '.84rem', fontFamily: 'var(--font-sans)', resize: 'vertical', minHeight: 60 }}
            />
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              {d.status === 'open' && (
                <button onClick={() => setUnderReview(d.id)}
                  style={{ background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.25)', color: 'var(--warning)', padding: '.35rem .85rem', borderRadius: 7, cursor: 'pointer', fontSize: '.78rem', fontWeight: 600 }}>
                  Mark Under Review
                </button>
              )}
              <button onClick={() => resolve(d.id, 'resolved')}
                style={{ background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.25)', color: 'var(--success)', padding: '.35rem .85rem', borderRadius: 7, cursor: 'pointer', fontSize: '.78rem', fontWeight: 600 }}>
                Resolve
              </button>
              <button onClick={() => resolve(d.id, 'dismissed')}
                style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', color: '#FCA5A5', padding: '.35rem .85rem', borderRadius: 7, cursor: 'pointer', fontSize: '.78rem' }}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ))}

      {closed.length > 0 && (
        <div className="panel-section" style={{ padding: 0, overflow: 'hidden', marginTop: '1rem' }}>
          <div style={{ padding: '1rem 1.25rem .5rem', fontWeight: 700, fontSize: '.9rem', color: 'var(--muted)' }}>Closed Disputes</div>
          {closed.map(d => (
            <div key={d.id} style={{ padding: '.65rem 1.25rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontSize: '.84rem', fontWeight: 600 }}>{TYPE_LABEL[d.type]}</span>
                <span style={{ fontSize: '.75rem', color: 'var(--muted)', marginLeft: '.75rem' }}>{d.profiles?.full_name}</span>
              </div>
              <span style={{ padding: '.2rem .6rem', borderRadius: 100, fontSize: '.72rem', fontWeight: 600, background: 'rgba(16,185,129,.08)', color: 'var(--success)' }}>{d.status}</span>
            </div>
          ))}
        </div>
      )}

      {disputes.length === 0 && (
        <div className="panel-section" style={{ textAlign: 'center', color: 'var(--muted)' }}>
          <p>No disputes have been raised yet.</p>
        </div>
      )}
    </>
  )
}
