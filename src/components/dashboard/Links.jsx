import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import Icon from '../ui/Icon'

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export default function Links({ showToast, showPanel }) {
  const { session } = useApp()
  const [links,   setLinks]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [session?.user?.id])

  async function load() {
    if (!session?.user?.id) return
    setLoading(true)

    // brand_profiles is fetched separately — campaigns.brand_id is a FK to
    // profiles, so PostgREST cannot embed brand_profiles through it.
    const { data } = await supabase
      .from('affiliate_links')
      .select(`
        id, slug, discount_code, created_at,
        products:product_id(name, price),
        campaigns:campaign_id(title, commission_rate, brand_id)
      `)
      .eq('creator_id', session.user.id)
      .order('created_at', { ascending: false })

    // Clicks and earnings live in their own tables — pull the aggregates
    // rather than trusting a denormalised counter that nothing maintains.
    const ids = (data ?? []).map(l => l.id)
    let clickCounts = {}
    let earnings    = {}

    if (ids.length) {
      const [{ data: clicks }, { data: commissions }] = await Promise.all([
        supabase.from('clicks').select('affiliate_link_id').in('affiliate_link_id', ids),
        supabase.from('commissions')
          .select('affiliate_link_id, net_commission, status')
          .in('affiliate_link_id', ids),
      ])

      for (const c of clicks ?? []) {
        clickCounts[c.affiliate_link_id] = (clickCounts[c.affiliate_link_id] ?? 0) + 1
      }
      for (const c of commissions ?? []) {
        if (c.status === 'denied') continue
        earnings[c.affiliate_link_id] = (earnings[c.affiliate_link_id] ?? 0) + Number(c.net_commission)
      }
    }

    const pick     = v => (Array.isArray(v) ? v[0] : v)
    const brandIds = [...new Set((data ?? []).map(l => pick(l.campaigns)?.brand_id).filter(Boolean))]

    let brands = {}
    if (brandIds.length) {
      const { data: bp } = await supabase
        .from('brand_profiles').select('id, company_name').in('id', brandIds)
      brands = Object.fromEntries((bp ?? []).map(b => [b.id, b]))
    }

    setLinks((data ?? []).map(l => ({
      ...l,
      brand:  brands[pick(l.campaigns)?.brand_id] ?? null,
      url:    `${FUNCTIONS_BASE}/affiliate-redirect?code=${l.slug}`,
      clicks: clickCounts[l.id] ?? 0,
      earned: earnings[l.id] ?? 0,
    })))
    setLoading(false)
  }

  function copy(text, label = 'Link') {
    navigator.clipboard.writeText(text).then(() => showToast?.(`${label} copied`))
  }

  const one = v => (Array.isArray(v) ? v[0] : v)

  if (loading) return <p style={{ color: 'var(--muted)' }}>Loading your links…</p>

  if (links.length === 0) {
    return (
      <>
        <div className="page-header"><h2>My Affiliate Links</h2></div>
        <div className="links-table">
          <div className="empty-links">
            <Icon name="links" size={40} style={{ opacity: .5 }} />
            <p>No links yet. Apply to a campaign — once the COVO team approves you, your links appear here automatically.</p>
            <button className="btn-sm btn-primary" style={{ borderRadius: 8, marginTop: '.75rem' }} onClick={() => showPanel?.('campaigns')}>
              Browse campaigns
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-header"><h2>My Affiliate Links</h2></div>

      <div className="links-table">
        <div className="table-head">
          <span>Product</span>
          <span>Your Link</span>
          <span>Clicks</span>
          <span>Discount Code</span>
          <span>Earned</span>
          <span />
        </div>
        {links.map(l => {
          const product  = one(l.products)
          const campaign = one(l.campaigns)
          const brand    = l.brand

          return (
            <div className="table-row" key={l.id}>
              <div className="link-cell">
                <strong>{product?.name ?? campaign?.title ?? 'Product'}</strong>
                <span>{brand?.company_name ?? '—'}</span>
              </div>
              <div>
                <div className="link-url" onClick={() => copy(l.url)} title="Click to copy">{l.url}</div>
              </div>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{l.clicks}</span>
              <span>
                {l.discount_code
                  ? <code style={{ fontSize: '.74rem', cursor: 'pointer' }} onClick={() => copy(l.discount_code, 'Code')} title="Click to copy">{l.discount_code}</code>
                  : '—'}
              </span>
              <span style={{ color: 'var(--success)', fontVariantNumeric: 'tabular-nums' }}>R{l.earned.toFixed(2)}</span>
              <button className="btn-sm btn-ghost" style={{ borderRadius: 7 }} onClick={() => copy(l.url)}>Copy</button>
            </div>
          )
        })}
      </div>
    </>
  )
}
