import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { fetchCreatorStats, requestPayout, formatZAR, MIN_PAYOUT, PAYOUTS_ENABLED } from '../../lib/api/creator'
import Icon from '../ui/Icon'

const STATUS_COPY = {
  pending:   'clearing',
  confirmed: 'ready to withdraw',
  paid:      'paid out',
  held:      'on hold',
  denied:    'not approved',
}

export default function Earnings({ showToast }) {
  const { session } = useApp()
  const [stats,   setStats]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => { load() }, [session?.user?.id])

  async function load() {
    setLoading(true)
    setStats(await fetchCreatorStats(session?.user?.id))
    setLoading(false)
  }

  async function onRequestPayout() {
    if (!PAYOUTS_ENABLED) return
    if (!stats) return
    if (stats.available < MIN_PAYOUT) {
      return setError(`You need at least ${formatZAR(MIN_PAYOUT)} cleared before withdrawing.`)
    }

    setBusy(true); setError('')
    const { data, error: err } = await requestPayout()
    setBusy(false)

    if (err) return setError(err.message)
    showToast?.(`Payout of ${formatZAR(data?.amount)} requested — COVO will process it shortly.`)
    load()
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Loading your earnings…</p>

  const canWithdraw = PAYOUTS_ENABLED && (stats?.available ?? 0) >= MIN_PAYOUT
  const history     = stats?.commissions ?? []

  return (
    <>
      <div className="page-header">
        <h2>Earnings</h2>
        <button
          className="payout-btn"
          onClick={onRequestPayout}
          disabled={!canWithdraw || busy}
          style={!canWithdraw ? { opacity: .45, cursor: 'not-allowed' } : undefined}
          title={
            !PAYOUTS_ENABLED ? 'Withdrawals open once COVO payouts go live'
              : canWithdraw ? ''
              : `Minimum ${formatZAR(MIN_PAYOUT)} required`
          }
        >
          {!PAYOUTS_ENABLED ? 'Withdrawals opening soon'
            : busy ? 'Requesting…'
            : `Request Payout${canWithdraw ? ` · ${formatZAR(stats.available)}` : ''}`}
        </button>
      </div>

      {/* Their earnings are real and still accruing — say so plainly rather
          than leaving a greyed-out button to be read as something broken. */}
      {!PAYOUTS_ENABLED && (
        <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', color: 'var(--warning)', padding: '.7rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '.82rem', lineHeight: 1.55 }}>
          Withdrawals aren't open yet — we're finalising payouts with our payment
          provider. Your commissions keep accruing and clearing as normal, and
          everything you've earned will be waiting when they open.
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#FCA5A5', padding: '.7rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '.82rem' }}>
          {error}
        </div>
      )}

      <div className="earnings-top">
        <div className="earn-card featured">
          <div className="earn-label">Total Earned (All Time)</div>
          <div className="earn-val feat">{formatZAR(stats?.totalEarned)}</div>
          <div className="earn-sub">Your share, after the 8% platform fee</div>
        </div>
        <div className="earn-card">
          <div className="earn-label">Clearing</div>
          <div className="earn-val" style={{ color: 'var(--warning)' }}>{formatZAR(stats?.pending)}</div>
          <div className="earn-sub">Inside the return window</div>
        </div>
        <div className="earn-card">
          <div className="earn-label">Ready to Withdraw</div>
          <div className="earn-val" style={{ color: 'var(--success)' }}>{formatZAR(stats?.available)}</div>
          <div className="earn-sub">
            {stats?.pendingPayoutTotal > 0
              ? `${formatZAR(stats.pendingPayoutTotal)} already requested`
              : `Minimum ${formatZAR(MIN_PAYOUT)}`}
          </div>
        </div>
        <div className="earn-card">
          <div className="earn-label">Paid Out</div>
          <div className="earn-val">{formatZAR(stats?.paid)}</div>
          <div className="earn-sub">Settled to your account</div>
        </div>
      </div>

      {(stats?.payouts ?? []).length > 0 && (
        <div className="panel-section">
          <h3>Payout Requests</h3>
          <div className="tx-list">
            {stats.payouts.map(p => (
              <div className="tx-row" key={p.id}>
                <div className="tx-icon"><Icon name="payouts" size={16} /></div>
                <div className="tx-info">
                  <strong>{formatZAR(p.amount)}</strong>
                  <span>
                    Requested {new Date(p.created_at).toLocaleDateString('en-ZA')}
                    {p.processed_at && ` · paid ${new Date(p.processed_at).toLocaleDateString('en-ZA')}`}
                  </span>
                </div>
                <span className={`status-badge ${p.status === 'success' ? 'approved' : p.status === 'failed' ? 'rejected' : 'pending'}`}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel-section">
        <h3>Commission History</h3>
        {history.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
            <Icon name="earnings" size={34} style={{ opacity: .5, marginBottom: '.6rem' }} />
            <p style={{ fontWeight: 600, color: 'var(--warm-white)', marginBottom: '.3rem' }}>No commissions yet</p>
            <p style={{ fontSize: '.85rem' }}>Once someone buys through your link, it shows up here.</p>
          </div>
        ) : (
          <div className="tx-list">
            {history.map(c => {
              const campaign = Array.isArray(c.campaigns) ? c.campaigns[0] : c.campaigns
              const settled  = c.status === 'paid' || c.status === 'confirmed'
              return (
                <div className="tx-row" key={c.id}>
                  <div className="tx-icon"><Icon name="storefront" size={16} /></div>
                  <div className="tx-info">
                    <strong>{campaign?.title ?? 'Campaign'}</strong>
                    <span>
                      {new Date(c.created_at).toLocaleDateString('en-ZA')}
                      {' · '}{formatZAR(c.sale_amount)} order
                      {c.status === 'pending' && c.confirms_at &&
                        ` · clears ${new Date(c.confirms_at).toLocaleDateString('en-ZA')}`}
                    </span>
                  </div>
                  <span className={`tx-amount ${settled ? '' : 'pending'}`}>
                    {c.status === 'denied' ? '—' : `+${formatZAR(c.net_commission)}`}
                    <span style={{ color: 'var(--muted)', fontWeight: 400 }}> ({STATUS_COPY[c.status] ?? c.status})</span>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
