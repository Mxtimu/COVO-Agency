import Icon from '../ui/Icon'
export default function Overview({ user, links, joined, showPanel }) {
  const hour   = new Date().getHours()
  const greet  = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const activeCampaigns = 2 + joined.length
  const totalClicks     = 1247
  const convRate        = 4.2

  const ACTIVITIES = [
    { icon: 'storefront', text: 'Nike Air Zoom sale via your link',      sub: '2 hours ago · 1 conversion',       amount: '+R419.85',    cls: 'c-success' },
    { icon: 'links', text: 'Gymshark link — 47 new clicks',         sub: '5 hours ago',                       amount: '0 conv.',     cls: 'c-muted'   },
    { icon: 'earnings', text: 'Commission paid out to wallet',         sub: 'Yesterday · Whoop campaign',        amount: '+R6,241.50',  cls: 'c-success' },
    { icon: 'campaigns', text: 'Invited to Ritual Vitamins campaign',   sub: '2 days ago · 20% commission',       amount: 'Pending',     cls: 'c-warning' },
    { icon: 'storefront', text: 'Myprotein Impact Whey sale',           sub: '3 days ago · 2 conversions',        amount: '+R219.60',    cls: 'c-success' },
  ]

  const BARS = [
    { label: 'Whoop 4.0',     amount: 'R6,241.50', pct: 65 },
    { label: 'Nike Spring',   amount: 'R2,099.25', pct: 21 },
    { label: 'Myprotein',     amount: 'R1,197.60', pct: 12 },
    { label: 'Gymshark',      amount: 'R219.60',   pct: 2  },
  ]

  return (
    <>
      <div className="greeting">
        <h1>{greet}, {user?.first || 'there'}</h1>
        <p>Here's what's happening with your account today.</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-label"><Icon name="earnings" size={14} /> Total Earnings</div>
          <div className="stat-card-val green">R9,715.50</div>
          <div className="stat-card-delta"><Icon name="up" size={12} /> +R1,650.00 this week</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label"><Icon name="campaigns" size={14} /> Active Campaigns</div>
          <div className="stat-card-val purple">{activeCampaigns}</div>
          <div className="stat-card-delta">{Math.max(0, 6 - joined.length)} new available</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label"><Icon name="clicks" size={14} /> Total Clicks</div>
          <div className="stat-card-val">{(totalClicks + links.length * 47).toLocaleString()}</div>
          <div className="stat-card-delta"><Icon name="up" size={12} /> +142 this week</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label"><Icon name="target" size={14} /> Conversion Rate</div>
          <div className="stat-card-val">{convRate}%</div>
          <div className="stat-card-delta down">↓ -0.3% vs last week</div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel-section">
          <h3>
            Recent Activity
            <span className="see-all" onClick={() => showPanel('links')}>View links →</span>
          </h3>
          <div className="activity-list">
            {ACTIVITIES.map((a, i) => (
              <div className="activity-item" key={i}>
                <div className="activity-icon"><Icon name={a.icon} size={16} /></div>
                <div className="activity-body">
                  <p>{a.text}</p>
                  <span>{a.sub}</span>
                </div>
                <span className={`activity-amount ${a.cls}`}>{a.amount}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel-section">
          <h3>Earnings by Campaign</h3>
          <div className="earnings-bar-wrap">
            {BARS.map(b => (
              <div className="earn-row" key={b.label}>
                <div className="earn-row-top">
                  <span>{b.label}</span>
                  <span>{b.amount}</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${b.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
