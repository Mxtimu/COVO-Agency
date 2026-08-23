import Icon from '../ui/Icon'
const TRANSACTIONS = [
  { icon: 'earnings', title: 'Payout — Whoop Campaign',       sub: '15 Jan 2025',                  amount: '+R6,241.50', pending: false },
  { icon: 'storefront', title: 'Nike Air Zoom Sale',            sub: '28 Jan 2025 · 3 conversions',  amount: '+R1,259.55', pending: true  },
  { icon: 'storefront', title: 'Myprotein Impact Whey',         sub: '25 Jan 2025 · 5 conversions',  amount: '+R549.00',   pending: true  },
  { icon: 'storefront', title: 'Gymshark Legacy Tight',         sub: '22 Jan 2025 · 2 conversions',  amount: '+R287.76',   pending: true  },
  { icon: 'storefront', title: 'Ritual Essential Protein',      sub: '20 Jan 2025 · 4 conversions',  amount: '+R639.20',   pending: true  },
  { icon: 'target', title: 'Whoop Campaign — Commissions',  sub: '10 Jan 2025 · 18 conversions', amount: '+R14,576.76', pending: false },
]

export default function Earnings({ showToast }) {
  function requestPayout() {
    showToast('Payout of R3,450.00 requested! Arrives in 2–5 business days.')
  }

  return (
    <>
      <div className="page-header">
        <h2>Earnings</h2>
        <button className="payout-btn" onClick={requestPayout}>Request Payout</button>
      </div>

      <div className="earnings-top">
        <div className="earn-card featured">
          <div className="earn-label">Total Earned (All Time)</div>
          <div className="earn-val feat">R9,715.50</div>
          <div className="earn-sub">Across all campaigns</div>
        </div>
        <div className="earn-card">
          <div className="earn-label">Pending</div>
          <div className="earn-val" style={{ color: 'var(--warning)' }}>R3,450.00</div>
          <div className="earn-sub">Processing 2–5 days</div>
        </div>
        <div className="earn-card">
          <div className="earn-label">Paid Out</div>
          <div className="earn-val" style={{ color: 'var(--success)' }}>R6,265.50</div>
          <div className="earn-sub">Successfully paid</div>
        </div>
        <div className="earn-card">
          <div className="earn-label">Avg. Commission</div>
          <div className="earn-val">14.3%</div>
          <div className="earn-sub">Across active deals</div>
        </div>
      </div>

      <div className="panel-section">
        <h3>Transaction History</h3>
        <div className="tx-list">
          {TRANSACTIONS.map((t, i) => (
            <div className="tx-row" key={i}>
              <div className="tx-icon"><Icon name={t.icon} size={16} /></div>
              <div className="tx-info">
                <strong>{t.title}</strong>
                <span>{t.sub}</span>
              </div>
              <span className={`tx-amount ${t.pending ? 'pending' : ''}`}>
                {t.amount}{t.pending ? ' (pending)' : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
