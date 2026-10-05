import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { invokeFunction } from '../../lib/api/functions'
import { openPaystackModal } from '../../lib/api/paystackPopup'
import Icon from '../ui/Icon'

// Mirrors MIN_DEPOSIT in paystack-initialize-deposit. Checked in both places
// on purpose: here so the brand is told before a round trip, there because
// the browser's copy is a courtesy and the server's is the rule.
const MIN_DEPOSIT = 2000

export default function BrandPayments() {
  const { session } = useApp()
  const [escrows,  setEscrows]  = useState([])
  const [loading,  setLoading]  = useState(true)

  // ── Add funds ─────────────────────────────────────────────────────
  const [funding,   setFunding]   = useState(false)
  const [fundBusy,  setFundBusy]  = useState(false)
  const [fundError, setFundError] = useState('')
  const [fundForm,  setFundForm]  = useState({ campaign_id: '', amount: '' })
  const [fundPending, setFundPending] = useState('')

  const setFund = k => e => { setFundError(''); setFundPending(''); setFundForm(f => ({ ...f, [k]: e.target.value })) }

  // Paystack is initialised server-side, where the campaign is checked
  // against the signed-in brand before any transaction exists. The amount
  // typed here only decides what Paystack asks for — the escrow is credited
  // from what Paystack reports was actually paid, on the signed webhook.
  async function startDeposit(e) {
    e.preventDefault()
    if (!fundForm.campaign_id) return setFundError('Choose which campaign to fund.')

    const amount = Number(fundForm.amount)
    if (!Number.isFinite(amount) || amount < MIN_DEPOSIT) {
      return setFundError(`The smallest deposit is R${MIN_DEPOSIT.toLocaleString('en-ZA')}. A campaign pauses below R500, so a smaller top-up would not keep it running for long.`)
    }

    setFundBusy(true); setFundError('')
    const { data, error } = await invokeFunction('paystack-initialize-deposit', {
      campaign_id: fundForm.campaign_id,
      amount,
    })

    if (error) { setFundBusy(false); return setFundError(error) }

    try {
      const outcome = await openPaystackModal(data.access_code)
      setFundBusy(false)

      if (outcome === 'cancelled') {
        // Nothing was charged and nothing was credited. The staged tranche
        // stays pending and simply never gets claimed.
        setFundError('Payment cancelled — nothing has been charged.')
        return
      }

      // Paystack has the money. Our balance moves when the signed webhook
      // lands, which is usually seconds but is not guaranteed to be instant,
      // so this says what is true rather than showing a total that has not
      // changed yet.
      setFunding(false)
      setFundForm({ campaign_id: '', amount: '' })
      setFundPending(`R${amount.toLocaleString('en-ZA')} received. Your escrow balance updates as soon as Paystack confirms it — usually within a minute.`)
      // Re-read shortly after, by which time the webhook has normally arrived.
      setTimeout(load, 6000)
    } catch (modalError) {
      setFundBusy(false)
      // The modal could not open — an ad blocker, an offline moment. The
      // transaction is already real, so send them to Paystack's own page for
      // the same reference rather than making them start again.
      console.error('[paystack modal]', modalError)
      if (data.authorization_url) {
        window.location.href = data.authorization_url
        return
      }
      setFundError('Could not open the payment window. Please try again.')
    }
  }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('campaign_escrow')
      .select('id, campaign_id, balance, total_deposited, total_paid_out, status, campaigns(title)')
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

      {/* Paystack has the money; our balance follows when the webhook lands.
          Said plainly rather than showing a total that has not moved yet. */}
      {fundPending && (
        <div style={{ background: 'rgba(195,206,148,.08)', border: '1px solid rgba(195,206,148,.28)', color: 'var(--sage)', padding: '.7rem 1rem', borderRadius: 9, fontSize: '.84rem', marginBottom: '1rem', lineHeight: 1.55 }}>
          {fundPending}
        </div>
      )}

      {/* Add funds */}
      <div className="panel-section" style={{ marginBottom: '1.5rem', borderLeft: '3px solid var(--sage)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: '.25rem' }}>Fund your campaigns</div>
            <div style={{ fontSize: '.84rem', color: 'var(--muted)', lineHeight: 1.5, maxWidth: '52ch' }}>
              Deposits are held in escrow against the campaign you choose, and only
              released to creators once a sale clears its return window. A campaign
              pauses automatically if its balance drops below R500.
            </div>
          </div>
          {!funding && (
            <button
              onClick={() => { setFunding(true); setFundError('') }}
              disabled={escrows.length === 0}
              title={escrows.length === 0 ? 'No campaign has an escrow account yet' : ''}
              style={{ background: 'var(--gradient)', border: 'none', color: 'white', padding: '.55rem 1.35rem', borderRadius: 9, cursor: escrows.length === 0 ? 'not-allowed' : 'pointer', fontWeight: 700, fontFamily: 'var(--font-sans)', fontSize: '.85rem', opacity: escrows.length === 0 ? .5 : 1, whiteSpace: 'nowrap' }}
            >
              Add funds
            </button>
          )}
        </div>

        {funding && (
          <form onSubmit={startDeposit} style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>
            {fundError && (
              <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#FCA5A5', padding: '.5rem .85rem', borderRadius: 8, fontSize: '.8rem', marginBottom: '.85rem', lineHeight: 1.5 }}>
                {fundError}
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label>Campaign</label>
                <select value={fundForm.campaign_id} onChange={setFund('campaign_id')}>
                  <option value="">Choose a campaign</option>
                  {escrows.map(e => {
                    const c = Array.isArray(e.campaigns) ? e.campaigns[0] : e.campaigns
                    return (
                      <option key={e.id} value={e.campaign_id}>
                        {c?.title || 'Campaign'} — R{Number(e.balance).toFixed(2)} in escrow
                      </option>
                    )
                  })}
                </select>
              </div>
              <div className="form-group">
                <label>Amount (ZAR)</label>
                <input type="number" inputMode="decimal" min="2000" step="500" placeholder="5000"
                  value={fundForm.amount} onChange={setFund('amount')} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="submit" disabled={fundBusy}
                style={{ background: 'var(--gradient)', border: 'none', color: 'white', padding: '.5rem 1.2rem', borderRadius: 8, cursor: fundBusy ? 'wait' : 'pointer', fontWeight: 700, fontSize: '.84rem', fontFamily: 'var(--font-sans)' }}>
                {fundBusy ? 'Opening Paystack…' : 'Continue to payment'}
              </button>
              <button type="button" onClick={() => { setFunding(false); setFundError('') }}
                style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', padding: '.5rem 1.2rem', borderRadius: 8, cursor: 'pointer', fontSize: '.84rem', fontFamily: 'var(--font-sans)' }}>
                Cancel
              </button>
              <span style={{ fontSize: '.76rem', color: 'var(--muted)' }}>
                Minimum R2 000. Paystack opens in a window here — you won't leave the page.
              </span>
            </div>
          </form>
        )}
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
