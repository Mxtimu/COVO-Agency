import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { formatZAR } from '../../lib/api/creator'
import Icon from '../ui/Icon'

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

// Links are minted by COVO when an admin approves the creator into a campaign,
// so this is no longer a "generate a link" screen — it is the shelf of products
// the creator has been cleared to promote, with the link already attached.
export default function Storefront({ showToast, showPanel }) {
  const { session } = useApp()
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [session?.user?.id])

  async function load() {
    if (!session?.user?.id) return
    setLoading(true)

    const { data } = await supabase
      .from('affiliate_links')
      .select(`
        id, slug, discount_code,
        products:product_id(id, name, price),
        campaigns:campaign_id(title, commission_rate, brand_id)
      `)
      .eq('creator_id', session.user.id)
      .order('created_at', { ascending: false })

    const pick     = v => (Array.isArray(v) ? v[0] : v)
    const brandIds = [...new Set((data ?? []).map(l => pick(l.campaigns)?.brand_id).filter(Boolean))]

    let brands = {}
    if (brandIds.length) {
      const { data: bp } = await supabase
        .from('brand_profiles').select('id, company_name').in('id', brandIds)
      brands = Object.fromEntries((bp ?? []).map(b => [b.id, b]))
    }

    setItems((data ?? []).map(l => ({
      ...l,
      product:  pick(l.products),
      campaign: pick(l.campaigns),
      brand:    brands[pick(l.campaigns)?.brand_id] ?? null,
      url:      `${FUNCTIONS_BASE}/affiliate-redirect?code=${l.slug}`,
    })))
    setLoading(false)
  }

  function copy(text, label = 'Link') {
    navigator.clipboard.writeText(text).then(() => showToast?.(`${label} copied`))
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Loading your storefront…</p>

  if (items.length === 0) {
    return (
      <>
        <div className="page-header"><h2>My Storefront</h2></div>
        <div className="panel-section" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <Icon name="storefront" size={40} style={{ opacity: .5, marginBottom: '.75rem' }} />
          <p style={{ fontWeight: 600, color: 'var(--warm-white)', marginBottom: '.35rem' }}>
            Nothing to promote yet
          </p>
          <p style={{ fontSize: '.875rem', color: 'var(--muted)', marginBottom: '1rem' }}>
            Apply to a campaign. Once COVO approves you, its products appear here with your
            links ready to share.
          </p>
          <button className="btn-sm btn-primary" style={{ borderRadius: 8 }} onClick={() => showPanel?.('campaigns')}>
            Browse campaigns
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-header">
        <h2>My Storefront</h2>
        <span style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
          {items.length} product{items.length === 1 ? '' : 's'} you're cleared to promote
        </span>
      </div>

      <div className="products-grid">
        {items.map(item => {
          const rate = item.campaign ? (Number(item.campaign.commission_rate) * 100).toFixed(0) : null
          const earn = item.product?.price && item.campaign
            ? Number(item.product.price) * Number(item.campaign.commission_rate) * 0.92  // less the 8% platform fee
            : null

          return (
            <div className="product-card" key={item.id}>
              <div className="product-img" style={{ background: 'var(--dark3)' }}>
                <Icon name="package" size={32} />
              </div>
              <div className="product-body">
                <div className="product-brand">{item.brand?.company_name ?? 'Brand'}</div>
                <div className="product-name">{item.product?.name ?? item.campaign?.title ?? 'Product'}</div>
                <div className="product-meta">
                  <span className="product-price">
                    {item.product?.price != null ? formatZAR(item.product.price) : '—'}
                  </span>
                  {earn != null && <span className="product-comm">you earn {formatZAR(earn)}</span>}
                </div>

                <div className="link-preview">
                  <span style={{ wordBreak: 'break-all' }}>{item.url}</span>
                  <span className="copy-icon" onClick={() => copy(item.url)}><Icon name="copy" size={15} /></span>
                </div>

                {item.discount_code && (
                  <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginBottom: '.5rem' }}>
                    Discount code:{' '}
                    <code style={{ color: 'var(--sage)', cursor: 'pointer' }}
                          onClick={() => copy(item.discount_code, 'Code')}>
                      {item.discount_code}
                    </code>
                  </div>
                )}

                <button className="btn-sm btn-primary" style={{ borderRadius: 8, width: '100%' }}
                        onClick={() => copy(item.url)}>
                  <Icon name="copy" size={14} /> Copy Link
                  {rate && <span style={{ opacity: .8 }}> · {rate}%</span>}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
