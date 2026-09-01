import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { formatZAR } from '../../lib/api/creator'
import Icon from '../ui/Icon'

// The four components, in the order they carry weight. `max` mirrors the
// point allocation in covo_score_breakdown.sql — if that changes, this has
// to change with it, which is why the totals are labelled rather than
// hardcoded into prose.
const COMPONENTS = [
  {
    key:   'conversion_points',
    max:   40,
    label: 'Conversion rate',
    blurb: 'How often your clicks turn into sales',
    help:  'Share links with the people most likely to buy, rather than the widest possible audience. A smaller, better-matched audience scores higher here than a large indifferent one.',
  },
  {
    key:   'volume_points',
    max:   25,
    label: 'Sales volume',
    blurb: 'How much evidence there is to judge',
    help:  'This one only moves with time and sales. It is the evidence behind the rest of your score, so it is never scaled down for being early.',
  },
  {
    key:   'order_value_points',
    max:   15,
    label: 'Average order value',
    blurb: 'What your audience spends per order',
    help:  'Campaigns with higher-priced products lift this. Full marks at an average order of R2 000.',
  },
  {
    key:   'reliability_points',
    max:   20,
    label: 'Reliability',
    blurb: 'Returns and disputes against your sales',
    help:  'Lost to refunded orders and disputes. Being straight with your audience about what a product actually does is what protects this.',
  },
]

function band(score, hasHistory) {
  if (!hasHistory)  return { label: 'Unproven',    color: 'var(--muted)'   }
  if (score >= 85)  return { label: 'Elite',       color: 'var(--success)' }
  if (score >= 70)  return { label: 'Strong',      color: 'var(--success)' }
  if (score >= 40)  return { label: 'Established', color: 'var(--sage)'    }
  return              { label: 'Building',     color: 'var(--warning)' }
}

export default function CovoScore({ creatorId }) {
  const { session } = useApp()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const id = creatorId ?? session?.user?.id

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!id) return
      setLoading(true)
      const { data: rows, error: err } = await supabase.rpc('covo_score_breakdown', { p_creator: id })
      if (cancelled) return
      if (err) setError(err.message)
      else setData(Array.isArray(rows) ? rows[0] : rows)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <div className="panel-section">
        <h3>COVO Score</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Calculating…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="panel-section">
        <h3>COVO Score</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>
          Your score could not be loaded just now. It is safe — it is recalculated
          from your sales every night.
        </p>
      </div>
    )
  }

  const score      = data?.total ?? 0
  const hasHistory = (data?.clicks ?? 0) > 0 || (data?.sales ?? 0) > 0
  const tier       = band(score, hasHistory)

  // The component with the most points still on the table, so the advice
  // points at what would actually move the number rather than at whatever
  // happens to be lowest in absolute terms.
  const weakest = hasHistory
    ? [...COMPONENTS].sort((a, b) =>
        (b.max - (data?.[b.key] ?? 0)) - (a.max - (data?.[a.key] ?? 0)))[0]
    : null

  return (
    <div className="panel-section">
      <h3>
        COVO Score
        <span style={{ fontSize: '.72rem', fontWeight: 500, color: 'var(--muted)', textTransform: 'none', letterSpacing: 0 }}>
          Recalculated nightly
        </span>
      </h3>

      {/* Headline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', padding: '1.15rem 1.25rem', background: 'var(--dark3)', borderRadius: 12, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '.2rem' }}>
          <span style={{ fontSize: '2.9rem', fontWeight: 800, letterSpacing: '-.03em', color: tier.color, lineHeight: 1 }}>
            {hasHistory ? score : '—'}
          </span>
          <span style={{ fontSize: '1rem', color: 'var(--muted)', fontWeight: 600 }}>/100</span>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 700, color: tier.color, marginBottom: '.2rem' }}>{tier.label}</div>
          <div style={{ fontSize: '.82rem', color: 'var(--muted)', lineHeight: 1.5 }}>
            {hasHistory
              ? 'Brands see this when you apply to a campaign.'
              : 'You have no sales history yet, so there is nothing to score. This reads as unproven, not bad — brands know the difference.'}
          </div>
        </div>
      </div>

      {/* Component breakdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
        {COMPONENTS.map(c => {
          const pts = Number(data?.[c.key] ?? 0)
          const pct = Math.min(100, (pts / c.max) * 100)
          return (
            <div className="earn-row" key={c.key}>
              <div className="earn-row-top">
                <span style={{ fontWeight: 600 }}>{c.label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {pts.toFixed(1)} <span style={{ opacity: .6 }}>/ {c.max}</span>
                </span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{c.blurb}</div>
            </div>
          )
        })}
      </div>

      {/* The numbers behind it */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '.75rem', marginTop: '1.25rem', paddingTop: '1.15rem', borderTop: '1px solid var(--border)' }}>
        {[
          ['Clicks',        (data?.clicks ?? 0).toLocaleString('en-ZA')],
          ['Sales',         data?.sales ?? 0],
          ['Conversion',    `${Number(data?.conv_rate ?? 0).toFixed(2)}%`],
          ['Avg order',     formatZAR(data?.avg_order)],
          ['Disputes',      data?.disputes ?? 0],
        ].map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize: '.68rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.2rem' }}>{label}</div>
            <div style={{ fontWeight: 700, fontSize: '.95rem', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Confidence — the part people would otherwise read as the score
          being broken, because a clean record early still scores low. */}
      {hasHistory && Number(data?.confidence ?? 0) < 1 && (
        <div style={{ marginTop: '1.15rem', padding: '.75rem .9rem', background: 'rgba(195,206,148,.06)', border: '1px solid rgba(195,206,148,.18)', borderRadius: 9, fontSize: '.79rem', color: 'var(--muted)', lineHeight: 1.55 }}>
          <Icon name="lock" size={13} style={{ verticalAlign: 'text-bottom', marginRight: '.35rem' }} />
          Parts of your score are scaled to <strong style={{ color: 'var(--sage)' }}>{Math.round(Number(data.confidence) * 100)}%</strong> while
          you build a track record, reaching full weight at 20 sales. Two sales
          cannot tell a brand as much as twenty, so early numbers are held back
          rather than allowed to swing the score.
        </div>
      )}

      {/* What would actually move it */}
      {weakest && score < 100 && (
        <div style={{ marginTop: '.75rem', padding: '.75rem .9rem', background: 'var(--dark3)', borderRadius: 9, fontSize: '.79rem', color: 'var(--muted)', lineHeight: 1.55 }}>
          <strong style={{ color: 'var(--warm-white)' }}>Biggest opportunity — {weakest.label.toLowerCase()}:</strong>{' '}
          {weakest.help}
        </div>
      )}
    </div>
  )
}
