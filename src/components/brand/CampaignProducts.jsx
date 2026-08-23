import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import Icon from '../ui/Icon'

// Products are what creators actually link to. Every affiliate link points at
// a product's tracking_url, so a campaign with no products can't generate
// links — which is why this sits directly under each campaign row.
export default function CampaignProducts({ campaignId }) {
  const [products, setProducts] = useState([])
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
    const { data } = await supabase
      .from('products')
      .select('id, name, price, tracking_url, created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
    setProducts(data ?? [])
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

  async function removeProduct(id) {
    if (!confirm('Remove this product? Every creator link pointing at it will stop working immediately. To correct a detail, use Edit instead — that keeps existing links working.')) return
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) return alert(error.message)
    load()
  }

  if (loading) return <p style={{ color: 'var(--muted)', fontSize: '.8rem', margin: 0 }}>Loading products…</p>

  return (
    <div style={{ padding: '.75rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.6rem' }}>
        <span style={{ fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }}>
          Products ({products.length})
        </span>
        <button
          onClick={() => { setAdding(a => !a); setError('') }}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--sage)', padding: '.2rem .6rem', borderRadius: 6, cursor: 'pointer', fontSize: '.72rem', fontWeight: 600 }}
        >
          {adding ? <><Icon name="close" size={13} /> Cancel</> : <><Icon name="add" size={13} /> Add product</>}
        </button>
      </div>

      {products.length === 0 && !adding && (
        <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: 0 }}>
          No products yet. Creators can't generate links until this campaign has at least one.
        </p>
      )}

      {products.map(p => editing === p.id ? (
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
          <button onClick={() => startEdit(p)}
            style={{ background: 'transparent', border: 'none', color: 'var(--sage)', cursor: 'pointer', fontSize: '.74rem', fontWeight: 600 }}
            title="Edit product">Edit</button>
          <button onClick={() => removeProduct(p.id)}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
            title="Remove product"><Icon name="close" size={14} /></button>
        </div>
      ))}

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
