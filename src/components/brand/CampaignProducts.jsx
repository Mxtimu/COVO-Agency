import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import Icon from '../ui/Icon'

// Products are what creators actually link to. Every affiliate link points at
// a product's tracking_url, so a campaign with no products can't generate
// links — which is why this sits directly under each campaign row.
export default function CampaignProducts({ campaignId }) {
  const [products, setProducts] = useState([])
  const [usage,    setUsage]    = useState({})   // product_id → counts
  const [showArchived, setShowArchived] = useState(false)
  const [loading,  setLoading]  = useState(true)
  const [adding,   setAdding]   = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')
  const [form,     setForm]     = useState({ name: '', price: '', tracking_url: '' })
  const [editing,  setEditing]  = useState(null)   // product id being edited
  const [editForm, setEditForm] = useState({ name: '', price: '', tracking_url: '' })

  useEffect(() => { load() }, [campaignId])

  async function load() {
    setLoading(true)
    // Usage counts come alongside the products themselves: a brand deciding
    // whether to remove something needs to see what it is carrying first.
    // Deleting used to be a confirm() dialog that could not tell you whether
    // you were about to break one creator or forty.
    const [{ data }, { data: usageRows }] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, price, tracking_url, created_at, archived_at')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false }),
      supabase.rpc('product_usage', { p_campaign_id: campaignId }),
    ])
    setProducts(data ?? [])
    setUsage(Object.fromEntries((usageRows ?? []).map(u => [u.product_id, u])))
    setLoading(false)
  }

  const setF = k => e => { setError(''); setForm(f => ({ ...f, [k]: e.target.value })) }

  async function addProduct(e) {
    e.preventDefault()
    if (!form.name.trim()) return setError('Please enter a product name.')

    let url = form.tracking_url.trim()
    if (!url) return setError('Please enter the product page URL.')
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    try { new URL(url) } catch { return setError('That does not look like a valid URL.') }

    if (form.price && isNaN(Number(form.price))) return setError('Price must be a number.')

    setBusy(true); setError('')
    const { error } = await supabase.from('products').insert({
      campaign_id:  campaignId,
      name:         form.name.trim(),
      price:        form.price ? Number(form.price) : null,
      tracking_url: url,
    })
    setBusy(false)
    if (error) return setError(error.message)

    setForm({ name: '', price: '', tracking_url: '' })
    setAdding(false)
    load()
  }

  // Shared by add and edit so both accept "shop.co.za/item" and store it usable.
  function normaliseUrl(raw) {
    let url = (raw ?? '').trim()
    if (!url) return { error: 'Please enter the product page URL.' }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    try { new URL(url) } catch { return { error: 'That does not look like a valid URL.' } }
    return { url }
  }

  function startEdit(p) {
    setError('')
    setEditing(p.id)
    setEditForm({
      name:         p.name ?? '',
      price:        p.price != null ? String(p.price) : '',
      tracking_url: p.tracking_url ?? '',
    })
  }

  const setE = k => e => { setError(''); setEditForm(f => ({ ...f, [k]: e.target.value })) }

  async function saveEdit(id) {
    if (!editForm.name.trim()) return setError('Please enter a product name.')
    const { url, error: urlError } = normaliseUrl(editForm.tracking_url)
    if (urlError) return setError(urlError)
    if (editForm.price && isNaN(Number(editForm.price))) return setError('Price must be a number.')

    setBusy(true); setError('')
    const { error } = await supabase.from('products').update({
      name:         editForm.name.trim(),
      price:        editForm.price ? Number(editForm.price) : null,
      tracking_url: url,
    }).eq('id', id)
    setBusy(false)

    if (error) return setError(error.message)
    setEditing(null)
    load()
  }

  // Retiring a product that creators are already carrying. Their links keep
  // resolving and past sales keep their product reference; it just stops
  // being offered to anyone new. This is the safe path, and for anything
  // with history it is the only one the database will allow.
  async function archiveProduct(p) {
    const u = usage[p.id]
    const carrying = u?.links
      ? `${u.links} creator link${u.links === 1 ? '' : 's'} will keep working, and ${u.commissions} recorded sale${u.commissions === 1 ? '' : 's'} keep their product.`
      : 'Nothing is linking to it yet.'

    if (!confirm(`Archive "${p.name}"?\n\n${carrying}\n\nCreators stop seeing it and no new links will be generated for it. You can restore it at any time.`)) return

    setBusy(true); setError('')
    const { error } = await supabase.from('products')
      .update({ archived_at: new Date().toISOString() }).eq('id', p.id)
    setBusy(false)
    if (error) return setError(error.message)
    load()
  }

  async function restoreProduct(p) {
    setBusy(true); setError('')
    const { error } = await supabase.from('products')
      .update({ archived_at: null }).eq('id', p.id)
    setBusy(false)
    if (error) return setError(error.message)
    load()
  }

  // Hard delete, kept only for a product nothing references — the genuine
  // "I typed that in wrong a second ago" case. Anything with history is
  // refused by guard_product_delete() in the database regardless of what
  // this function does, so the message below explains rather than gates.
  async function removeProduct(p) {
    const u = usage[p.id]
    if (u && !u.can_delete) {
      return setError(`"${p.name}" has ${u.links} creator link(s) and ${u.commissions} sale(s). Archive it instead — deleting would break those links and erase which product each sale was for.`)
    }
    if (!confirm(`Delete "${p.name}"? Nothing is linking to it yet, so nothing breaks.`)) return

    setBusy(true); setError('')
    const { error } = await supabase.from('products').delete().eq('id', p.id)
    setBusy(false)
    // The trigger raises if something started referencing it between the
    // check above and this call.
    if (error) return setError(error.message)
    load()
  }

  if (loading) return <p style={{ color: 'var(--muted)', fontSize: '.8rem', margin: 0 }}>Loading products…</p>

  const active   = products.filter(p => !p.archived_at)
  const archived = products.filter(p =>  p.archived_at)

  return (
    <div style={{ padding: '.75rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.6rem' }}>
        <span style={{ fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }}>
          Products ({active.length})
        </span>
        <button
          onClick={() => { setAdding(a => !a); setError('') }}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--sage)', padding: '.2rem .6rem', borderRadius: 6, cursor: 'pointer', fontSize: '.72rem', fontWeight: 600 }}
        >
          {adding ? <><Icon name="close" size={13} /> Cancel</> : <><Icon name="add" size={13} /> Add product</>}
        </button>
      </div>

      {active.length === 0 && !adding && (
        <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: 0 }}>
          {archived.length > 0
            ? 'No products on offer. Restore an archived one below, or add a new one.'
            : "No products yet. Creators can't generate links until this campaign has at least one."}
        </p>
      )}

      {error && !adding && editing === null && (
        <p style={{ color: '#FCA5A5', fontSize: '.76rem', margin: '.35rem 0' }}>{error}</p>
      )}

      {active.map(p => editing === p.id ? (
        <div key={p.id} style={{ display: 'grid', gap: '.5rem', padding: '.6rem 0', borderBottom: '1px solid var(--border)' }}>
          <input value={editForm.name} onChange={setE('name')} placeholder="Product name" style={inputStyle} />
          <input value={editForm.price} onChange={setE('price')} placeholder="Price in ZAR (optional)" inputMode="decimal" style={inputStyle} />
          <input value={editForm.tracking_url} onChange={setE('tracking_url')} placeholder="Product page URL" style={inputStyle} />
          <div style={{ display: 'flex', gap: '.4rem' }}>
            <button onClick={() => saveEdit(p.id)} disabled={busy}
              style={{ background: 'var(--gradient)', border: 'none', color: 'white', padding: '.35rem .9rem', borderRadius: 7, cursor: busy ? 'wait' : 'pointer', fontWeight: 700, fontSize: '.76rem' }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setEditing(null); setError('') }}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '.35rem .9rem', borderRadius: 7, cursor: 'pointer', fontSize: '.76rem' }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.4rem 0', borderBottom: '1px solid var(--border)', fontSize: '.8rem' }}>
          <span style={{ fontWeight: 600, flex: 1 }}>{p.name}</span>
          <span style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {p.price != null ? `R${Number(p.price).toFixed(2)}` : '—'}
          </span>
          <a href={p.tracking_url} target="_blank" rel="noreferrer"
             style={{ color: 'var(--sage)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.tracking_url}
          </a>
          {/* What this product is carrying, so removing it is never a
              guess. Silence here is what made deletion dangerous. */}
          {usage[p.id]?.links > 0 && (
            <span style={{ color: 'var(--muted)', fontSize: '.72rem', whiteSpace: 'nowrap' }} title={`${usage[p.id].creators} creator(s), ${usage[p.id].clicks} clicks, ${usage[p.id].commissions} sales`}>
              {usage[p.id].links} link{usage[p.id].links === 1 ? '' : 's'} · {usage[p.id].clicks} click{usage[p.id].clicks === 1 ? '' : 's'}
            </span>
          )}
          <button onClick={() => startEdit(p)}
            style={{ background: 'transparent', border: 'none', color: 'var(--sage)', cursor: 'pointer', fontSize: '.74rem', fontWeight: 600 }}
            title="Edit product — keeps every existing link working">Edit</button>
          {usage[p.id]?.can_delete === false ? (
            <button onClick={() => archiveProduct(p)} disabled={busy}
              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '.74rem', fontWeight: 600 }}
              title="Stop offering this product — existing creator links keep working">Archive</button>
          ) : (
            <button onClick={() => removeProduct(p)} disabled={busy}
              style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
              title="Delete — nothing is linking to this yet"><Icon name="close" size={14} /></button>
          )}
        </div>
      ))}

      {/* Archived — out of the way, but restorable. */}
      {archived.length > 0 && (
        <div style={{ marginTop: '.75rem' }}>
          <button
            onClick={() => setShowArchived(s => !s)}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '.72rem', fontWeight: 600, padding: 0 }}
          >
            {showArchived ? '▾' : '▸'} Archived ({archived.length})
          </button>

          {showArchived && archived.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.4rem 0', borderBottom: '1px solid var(--border)', fontSize: '.8rem', opacity: .65 }}>
              <span style={{ flex: 1, textDecoration: 'line-through' }}>{p.name}</span>
              <span style={{ color: 'var(--muted)', fontSize: '.72rem' }}>
                {usage[p.id]?.links ?? 0} link{usage[p.id]?.links === 1 ? '' : 's'} still resolving
              </span>
              <button onClick={() => restoreProduct(p)} disabled={busy}
                style={{ background: 'transparent', border: 'none', color: 'var(--sage)', cursor: 'pointer', fontSize: '.74rem', fontWeight: 600 }}
                title="Offer this product to creators again">Restore</button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <form onSubmit={addProduct} style={{ display: 'grid', gap: '.5rem', marginTop: '.75rem' }}>
          <input value={form.name} onChange={setF('name')} placeholder="Product name"
            style={inputStyle} />
          <input value={form.price} onChange={setF('price')} placeholder="Price in ZAR (optional)" inputMode="decimal"
            style={inputStyle} />
          <input value={form.tracking_url} onChange={setF('tracking_url')} placeholder="Product page URL — where shoppers land"
            style={inputStyle} />
          {error && <p style={{ color: '#FCA5A5', fontSize: '.76rem', margin: 0 }}>{error}</p>}
          <button type="submit" disabled={busy}
            style={{ background: 'var(--gradient)', border: 'none', color: 'white', padding: '.45rem 1rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer', fontWeight: 700, fontSize: '.8rem', justifySelf: 'start' }}>
            {busy ? 'Adding…' : 'Add product'}
          </button>
        </form>
      )}
    </div>
  )
}

const inputStyle = {
  background: 'var(--dark3)',
  border: '1px solid var(--border)',
  color: 'var(--warm-white)',
  padding: '.45rem .7rem',
  borderRadius: 8,
  fontSize: '.8rem',
  fontFamily: 'var(--font-sans)',
}
