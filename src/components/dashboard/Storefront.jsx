import { PRODUCTS } from '../../data/campaigns'
import Icon from '../ui/Icon'

export default function Storefront({ user, links, saveLinks, showToast }) {
  function getLink(product) {
    const existing = links.find(l => l.pid === product.id)
    if (existing) {
      navigator.clipboard.writeText(existing.url).then(() => showToast('Link copied'))
      return
    }
    const uid  = user?.id || 'u123'
    const url  = `https://covo.app/r/${uid}/${product.id}`
    const link = { pid: product.id, productName: product.name, brand: product.brand, url, clicks: 0, conversions: 0, earned: 0, createdAt: new Date().toISOString() }
    saveLinks([...links, link])
    showToast(`Affiliate link created for ${product.name}`)
  }

  function copyExisting(url) {
    navigator.clipboard.writeText(url).then(() => showToast('Link copied'))
  }

  return (
    <>
      <div className="page-header">
        <h2>My Storefront</h2>
        <span style={{ fontSize: '.85rem', color: 'var(--muted)' }}>Products available to promote</span>
      </div>

      <div className="products-grid">
        {PRODUCTS.map(p => {
          const linked = links.find(l => l.pid === p.id)
          return (
            <div className="product-card" key={p.id}>
              <div className="product-img" style={{ background: p.bg + '33' }}><Icon name={p.icon} size={32} /></div>
              <div className="product-body">
                <div className="product-brand">{p.brand}</div>
                <div className="product-name">{p.name}</div>
                <div className="product-meta">
                  <span className="product-price">{p.price}</span>
                  <span className="product-comm">+{p.commission} per sale</span>
                </div>

                {linked && (
                  <div className="link-preview">
                    <span style={{ wordBreak: 'break-all' }}>{linked.url}</span>
                    <span className="copy-icon" onClick={() => copyExisting(linked.url)}><Icon name="copy" size={15} /></span>
                  </div>
                )}

                <button
                  className={`btn-sm ${linked ? 'btn-ghost' : 'btn-primary'}`}
                  style={{ borderRadius: 8, width: '100%' }}
                  onClick={() => getLink(p)}
                >
                  {linked ? <><Icon name="copy" size={14} /> Copy Link</> : <><Icon name="links" size={14} /> Get Affiliate Link</>}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
