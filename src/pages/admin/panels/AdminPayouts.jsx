import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { useApp } from '../../../context/AppContext'
import { PAYOUTS_ENABLED } from '../../../lib/api/creator'

export default function AdminPayouts() {
  const { session } = useApp()
  const [rows,     setRows]    = useState([]) // confirmed commissions grouped by creator
  const [payouts,  setPayouts] = useState([]) // payout history
  const [busy,     setBusy]    = useState({})
  const [loading,  setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [commRes, payRes] = await Promise.all([
      supabase.from('commissions')
        .select('id, creator_id, net_commission, profiles(full_name, email)')
        .eq('status', 'confirmed'),
      supabase.from('payouts')
        .select('id, creator_id, amount, status, created_at, profiles(full_name)')
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    // Group confirmed commissions by creator
    const grouped = {}
    for (const c of commRes.data ?? []) {
      if (!grouped[c.creator_id]) {
        grouped[c.creator_id] = { creator_id: c.creator_id, name: c.profiles?.full_name, email: c.profiles?.email, total: 0, ids: [] }
      }
      grouped[c.creator_id].total += Number(c.net_commission)
      grouped[c.creator_id].ids.push(c.id)
    }
    setRows(Object.values(grouped))
    setPayouts(payRes.data ?? [])
    setLoading(false)
  }

  // Two steps, deliberately separate: create the payout row, then ask
  // Paystack to move the money against it.
  //
  // They are split because the row is what makes the transfer safe to retry.
  // paystack-initiate-transfer claims the payout before calling out and
  // records the reference first, so a lost response still settles when the
  // webhook arrives. Creating the row inside the same call would leave
  // nothing to claim if the API failed halfway.
  //
  // Commissions become 'paid' only when Paystack confirms the transfer, via
  // mark_payout_settled from the webhook. Nothing here marks money as sent.
  async function initiatePayout(row) {
    if (!PAYOUTS_ENABLED) return
    setBusy(b => ({ ...b, [row.creator_id]: true }))

    const { data: payout, error: createError } = await supabase.from('payouts').insert({
      creator_id:     row.creator_id,
      amount:         row.total,
      status:         'pending',
      initiated_by:   session?.user?.id,
      commission_ids: row.ids,
    }).select('id').single()

    if (createError) {
      setBusy(b => ({ ...b, [row.creator_id]: false }))
      return alert(`Could not create payout: ${createError.message}`)
    }

    const { data: { session: s } } = await supabase.auth.getSession()
    const { data, error: fnError } = await supabase.functions.invoke('paystack-initiate-transfer', {
      body:    { payout_id: payout.id },
      headers: { Authorization: `Bearer ${s?.access_token}` },
    })

    setBusy(b => ({ ...b, [row.creator_id]: false }))

    if (fnError || data?.error) {
      // The function releases its own claim on failure, so the payout is
      // back to pending and can be retried once the cause is fixed.
      alert(`Transfer failed: ${data?.error ?? fnError?.message}\n\nThe payout is still pending — you can retry it.`)
    } else if (data?.needs_otp) {
      alert(`Transfer created, but Paystack is holding it for OTP confirmation.\n\nApprove it in the Paystack dashboard to release the money. Reference: ${data.reference}`)
    } else {
      alert(`Transfer sent — R${Number(row.total).toFixed(2)} to ${row.name || 'creator'}.\n\nIt shows as paid once Paystack confirms. Reference: ${data?.reference}`)
    }

    await load()
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Loading payout data…</p>

  return (
    <>
      <div className="page-header"><h2>Payouts</h2></div>

      <div className="panel-section" style={{ marginBottom: '1.5rem' }}>
        <h3>Ready to Pay Out ({rows.length} creators)</h3>
        {rows.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: '.875rem' }}>No confirmed commissions awaiting payout.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem', marginTop: '.5rem' }}>
            {rows.map(r => (
              <div key={r.creator_id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '.85rem 1rem', background: 'var(--dark3)', borderRadius: 10, border: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '.9rem' }}>{r.name || 'Unknown'}</div>
                  <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{r.email} · {r.ids.length} commission{r.ids.length !== 1 ? 's' : ''}</div>
                </div>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--success)' }}>R{r.total.toFixed(2)}</div>
                <button onClick={() => initiatePayout(r)} disabled={!PAYOUTS_ENABLED || busy[r.creator_id]}
                  title={PAYOUTS_ENABLED ? '' : 'Payouts are disabled until Paystack is connected'}
                  style={{ background: PAYOUTS_ENABLED ? 'var(--gradient)' : 'var(--dark3)', border: '1px solid var(--border)', color: PAYOUTS_ENABLED ? 'white' : 'var(--muted)', padding: '.45rem 1.1rem', borderRadius: 8, cursor: PAYOUTS_ENABLED ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '.82rem', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' }}>
                  {busy[r.creator_id] ? 'Processing…' : PAYOUTS_ENABLED ? 'Initiate Payout' : 'Awaiting Paystack'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel-section" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem 1.25rem .5rem', fontWeight: 700 }}>Payout History</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
            <thead>
              <tr style={{ background: 'var(--dark3)' }}>
                {['Creator','Amount','Status','Date'].map(h => (
                  <th key={h} style={{ padding: '.65rem 1rem', color: 'var(--muted)', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payouts.length === 0 && (
                <tr><td colSpan={4} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--muted)' }}>No payouts yet.</td></tr>
              )}
              {payouts.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '.65rem 1rem' }}>{p.profiles?.full_name || '—'}</td>
                  <td style={{ padding: '.65rem 1rem', fontWeight: 700, color: 'var(--success)' }}>R{Number(p.amount).toFixed(2)}</td>
                  <td style={{ padding: '.65rem 1rem' }}>
                    <span style={{ padding: '.2rem .6rem', borderRadius: 100, fontSize: '.72rem', fontWeight: 600,
                      background: p.status === 'success' ? 'rgba(16,185,129,.12)' : p.status === 'failed' ? 'rgba(239,68,68,.12)' : 'rgba(245,158,11,.12)',
                      color: p.status === 'success' ? 'var(--success)' : p.status === 'failed' ? '#FCA5A5' : 'var(--warning)',
                    }}>{p.status}</span>
                  </td>
                  <td style={{ padding: '.65rem 1rem', color: 'var(--muted)', fontSize: '.78rem' }}>
                    {new Date(p.created_at).toLocaleDateString('en-ZA')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
