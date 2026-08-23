import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { fetchCreatorStats, formatZAR, timeAgo } from '../../lib/api/creator'
import Icon from '../ui/Icon'

export default function Overview({ user, showPanel }) {
  const { session } = useApp()
  const [stats,   setStats]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const s = await fetchCreatorStats(session?.user?.id)
      if (!cancelled) { setStats(s); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [session?.user?.id])

  const hour  = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  if (loading) {
    return (
      <>
        <div className="greeting">
          <h1>{greet}, {user?.first || 'there'}</h1>
          <p>Loading your numbers…</p>
        </div>
      </>
    )
  }

  const activity = (stats?.commissions ?? []).slice(0, 6)
  const hasData  = (stats?.conversions ?? 0) > 0 || (stats?.clicks ?? 0) > 0

  return (
    <>
      <div className="greeting">
        <h1>{greet}, {user?.first || 'there'}</h1>
        <p>Here's what's happening with your account today.</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-label"><Icon name="earnings" size={14} /> Total Earnings</div>
          <div className="stat-card-val green">{formatZAR(stats?.totalEarned)}</div>
          <div className="stat-card-delta">
            {stats?.pending > 0 ? `${formatZAR(stats.pending)} still clearing` : 'All commissions cleared'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label"><Icon name="campaigns" size={14} /> Active Campaigns</div>
          <div className="stat-card-val purple">{stats?.activeCampaigns ?? 0}</div>
          <div className="stat-card-delta">
            <span className="see-all" onClick={() => showPanel('campaigns')}>Browse more →</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label"><Icon name="clicks" size={14} /> Total Clicks</div>
          <div className="stat-card-val">{(stats?.clicks ?? 0).toLocaleString('en-ZA')}</div>
          <div className="stat-card-delta">
            {stats?.conversions ?? 0} conversion{stats?.conversions === 1 ? '' : 's'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label"><Icon name="target" size={14} /> Conversion Rate</div>
          <div className="stat-card-val">{(stats?.convRate ?? 0).toFixed(1)}%</div>
          <div className="stat-card-delta">
            {stats?.clicks ? 'Of all link clicks' : 'No clicks yet'}
          </div>
        </div>
      </div>

      {!hasData && (
        <div className="panel-section" style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
          <Icon name="campaigns" size={36} style={{ opacity: .5, marginBottom: '.75rem' }} />
          <p style={{ fontWeight: 600, color: 'var(--warm-white)', marginBottom: '.35rem' }}>
            No activity yet
          </p>
          <p style={{ fontSize: '.875rem', color: 'var(--muted)', marginBottom: '1rem' }}>
            Apply to a campaign, and once you're approved your links appear here ready to share.
          </p>
          <button className="btn-sm btn-primary" style={{ borderRadius: 8 }} onClick={() => showPanel('campaigns')}>
            Browse campaigns
          </button>
        </div>
      )}

      {hasData && (
        <div className="two-col">
          <div className="panel-section">
            <h3>
              Recent Activity
              <span className="see-all" onClick={() => showPanel('links')}>View links →</span>
            </h3>
            {activity.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>
                Your links have clicks but no sales yet. Commissions appear here as they come in.
              </p>
            ) : (
              <div className="activity-list">
                {activity.map(c => {
                  const campaign = Array.isArray(c.campaigns) ? c.campaigns[0] : c.campaigns
                  const cls = c.status === 'paid' || c.status === 'confirmed' ? 'c-success'
                            : c.status === 'denied' ? 'c-muted' : 'c-warning'
                  return (
                    <div className="activity-item" key={c.id}>
                      <div className="activity-icon"><Icon name="storefront" size={16} /></div>
                      <div className="activity-body">
                        <p>Sale via {campaign?.title ?? 'your link'}</p>
                        <span>{timeAgo(c.created_at)} · {formatZAR(c.sale_amount)} order · {c.status}</span>
                      </div>
                      <span className={`activity-amount ${cls}`}>
                        {c.status === 'denied' ? '—' : `+${formatZAR(c.net_commission)}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="panel-section">
            <h3>Earnings by Campaign</h3>
            {(stats?.byCampaign ?? []).length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>No earnings yet.</p>
            ) : (
              <div className="earnings-bar-wrap">
                {stats.byCampaign.map(b => (
                  <div className="earn-row" key={b.id}>
                    <div className="earn-row-top">
                      <span>{b.label}</span>
                      <span>{formatZAR(b.amount)}</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${b.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
