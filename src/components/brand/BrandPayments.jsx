import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import Icon from '../ui/Icon'

export default function BrandPayments() {
  const { session } = useApp()
  const [escrows,  setEscrows]  = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('campaign_escrow')
      .select('id, balance, total_deposited, total_paid_out, status, campaigns(title)')
      .eq('brand_id', session?.user?.id)
      .order('created_at', { ascending: false })
    setEscrows(data ?? [])
    setLoading(false)
  }

  const totalBalance   = escrows.reduce((s, e) => s + Number(e.balance || 0), 0)
  const totalDeposited = escrows.reduce((s, e) => s + Number(e.total_deposited || 0), 0)
  const totalPaid      = escrows.reduce((s, e) => s + Number(e.total_paid_out || 0), 0)

  const ESC_STATUS = {
    active: { bg: 'rgba(16,185,129,.12)', color: 'var(--success)' },
    paused: { bg: 'rgba(245,158,11,.12)', color: 'var(--warning)' },
    closed: { bg: 'rgba(193,183,170,.08)', color: 'var(--muted)' },
  }

  return (
    <>
      <div className="page-header"><h2>Payments</h2></div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Escrow Balance', value: `R${totalBalance.toFixed(2)}`, color: 'var(--success)' },
          { label: 'Total Deposited',      value: `R${totalDeposited.toFixed(2)}`, color: 'var(--sage)' },
          { label: 'Total Paid Out',       value: `R${totalPaid.toFixed(2)}`, color: 'var(--muted)' },
        ].map(s => (
          <div key={s.label} className="panel-section" style={{ padding: '1.25rem 1.5rem' }}>
            <div style={{ fontSize: '.73rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '.5rem' }}>{s.label}</div>
            <div style={{ fontSize: '1.7rem', fontWeight: 800, color: s.color }}>{loading ? '—' : s.value}</div>
          </div>
        ))}
      </div>

      {/* Add funds notice */}
      <div className="panel-section" style={{ marginBottom: '1.5rem', borderLeft: '3px solid var(--sage)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: '.25rem' }}>Fund your campaigns</div>
          <div style={{ fontSize: '.84rem', color: 'var(--muted)', lineHeight: 1.5 }}>
            Escrow deposits are processed via Paystack. Your campaign pauses automatically if any escrow balance drops below R500.
          </div>
        </div>
        <button
          style={{ background: 'var(--gradient)', border: 'none', color: 'white', padding: '.55rem 1.35rem', borderRadius: 9, cursor: 'not-allowed', fontWeight: 700, fontFamily: 'var(--font-sans)', fontSize: '.85rem', opacity: .6 }}
          disabled
          title="Paystack integration coming soon"
        >
          Add funds (coming soon)
        </button>
      </div>

      {/* Escrow table */}
      <div className="panel-section" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem .5rem', fontWeight: 700 }}>Escrow Accounts</div>
        {loading ? (
          <p style={{ padding: '1.5rem', color: 'var(--muted)' }}>Loading…</p>
        ) : escrows.length === 0 ? (
          <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)', fontSize: '.875rem' }}>
            No escrow accounts yet. They're created automatically when your campaign is approved.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
              <thead>
                <tr style={{ background: 'var(--dark3)' }}>
                  {['Campaign', 'Balance', 'Deposited', 'Paid Out', 'Status'].map(h => (
                    <th key={h} style={{ padding: '.65rem 1rem', color: 'var(--muted)', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {escrows.map(e => {
                  const low = Number(e.balance) > 0 && Number(e.balance) < 500
                  const st  = ESC_STATUS[e.status] || ESC_STATUS.paused
                  const camp = Array.isArray(e.campaigns) ? e.campaigns[0] : e.campaigns
                  return (
                    <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '.65rem 1rem', fontWeight: 600 }}>{camp?.title || '—'}</td>
                      <td style={{ padding: '.65rem 1rem', fontWeight: 700, color: low ? 'var(--warning)' : 'var(--success)' }}>
                        R{Number(e.balance).toFixed(2)}{low && <Icon name="warning" size={13} style={{ marginLeft: '.3rem', verticalAlign: 'text-bottom' }} />}
                      </td>
                      <td style={{ padding: '.65rem 1rem', color: 'var(--muted)' }}>R{Number(e.total_deposited).toFixed(2)}</td>
                      <td style={{ padding: '.65rem 1rem', color: 'var(--muted)' }}>R{Number(e.total_paid_out).toFixed(2)}</td>
                      <td style={{ padding: '.65rem 1rem' }}>
                        <span style={{ padding: '.2rem .6rem', borderRadius: 100, fontSize: '.72rem', fontWeight: 600, background: st.bg, color: st.color }}>{e.status}</span>
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
