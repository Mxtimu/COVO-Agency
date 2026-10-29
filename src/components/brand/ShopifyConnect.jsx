import { useState, useEffect, useCallback } from 'react'
import {
  WEBHOOK_URL,
  WEBHOOK_EVENTS,
  themeSnippet,
  fetchShopifyStatus,
  connectShopify,
  disconnectShopify,
} from '../../lib/api/shopify'

// Brands connect their own store here. Before this, linking a shop meant a
// developer running admin_link_shopify_shop() in the SQL editor after the
// brand emailed over their signing secret — a developer per onboarding, and
// a secret sent by email.
//
// The order of the steps on screen matters: the brand has to create the
// webhooks in Shopify BEFORE Shopify will show them a signing secret. So
// the setup instructions come first and the form is last, rather than
// asking for a value they do not have yet.

const STATE_STYLE = {
  verified: { label: 'Connected', color: 'var(--sage)',    bg: 'rgba(122,154,122,.14)' },
  pending:  { label: 'Pending',   color: 'var(--warning)', bg: 'rgba(245,158,11,.12)' },
  disabled: { label: 'Switched off', color: 'var(--muted)', bg: 'rgba(255,255,255,.06)' },
  none:     { label: 'Not connected', color: 'var(--muted)', bg: 'rgba(255,255,255,.06)' },
}

function when(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function ShopifyConnect() {
  const [status, setStatus] = useState(null)
  const [domain, setDomain] = useState('')
  const [secret, setSecret] = useState('')
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState('')
  const [notice, setNotice] = useState('')
  const [showSetup, setShowSetup] = useState(false)
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    const { status: s, error: err } = await fetchShopifyStatus()
    if (err) {
      console.error('[shopify] status failed', err)
      setError('Could not load your store connection. Please refresh.')
      setStatus({ state: 'none' })
      return
    }
    setStatus(s)
  }, [])

  useEffect(() => { load() }, [load])

  // A pending connection confirms itself when Shopify sends its first
  // signed webhook, which can be seconds or hours away. Polling while the
  // brand is sitting on this screen means they see it flip without having
  // to reload and wonder whether it worked.
  useEffect(() => {
    if (status?.state !== 'pending') return
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [status?.state, load])

  async function copy(text, which) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      // Clipboard is blocked outside a secure context or without
      // permission. The value is on screen and selectable, so this is a
      // convenience failing, not the step failing.
      setCopied('')
    }
  }

  async function submit(e) {
    e.preventDefault()
    setError(''); setNotice('')

    if (!domain.trim())  return setError('Enter your Shopify domain.')
    if (!secret.trim())  return setError('Paste the signing secret from Shopify.')

    setBusy(true)
    const res = await connectShopify({ domain: domain.trim(), secret: secret.trim() })
    setBusy(false)

    if (!res.connected) {
      // out_outcome is written for the brand to read.
      setError(res.outcome || 'Could not connect that store.')
      return
    }

    setSecret('')
    setNotice(res.state === 'verified'
      ? 'Store reconnected.'
      : 'Saved. Waiting for the first order from your store to confirm the connection.')
    load()
  }

  async function disconnect() {
    setError(''); setNotice('')
    setBusy(true)
    const res = await disconnectShopify()
    setBusy(false)
    if (!res.disconnected) return setError(res.outcome || 'Could not disconnect.')
    setNotice('Store disconnected. Past orders and commissions are untouched.')
    load()
  }

  if (status === null) {
    return (
      <>
        <div className="panel-header"><h2>Shopify</h2></div>
        <p style={{ fontSize: '.875rem', color: 'var(--muted)' }}>Loading…</p>
      </>
    )
  }

  const s = STATE_STYLE[status.state] ?? STATE_STYLE.none
  const connected = status.state === 'verified' || status.state === 'pending'

  return (
    <>
      <div className="panel-header">
        <h2>Shopify</h2>
        <span style={{
          fontSize: '.74rem', padding: '.25rem .6rem', borderRadius: 999,
          background: s.bg, color: s.color, fontWeight: 600,
        }}>{s.label}</span>
      </div>

      <p className="sub" style={{ marginBottom: '1.25rem', maxWidth: '40rem', lineHeight: 1.55 }}>
        Connect your store and COVO tracks every order that comes from a creator's
        link — working out the commission, holding it through your return window,
        and reversing it if the order is refunded or cancelled.
      </p>

      {error  && <div className="error-banner"   style={{ marginBottom: '1rem' }}>{error}</div>}
      {notice && <div className="success-banner" style={{ marginBottom: '1rem' }}>{notice}</div>}

      {connected && (
        <div className="panel-section" style={{ marginBottom: '1.5rem' }}>
          <Row label="Store"        value={status.domain} mono />
          <Row label="Connected"    value={when(status.connectedAt)} />
          <Row label="Confirmed"    value={status.verifiedAt ? when(status.verifiedAt) : 'Not yet'} />
          <Row label="Last order"   value={status.lastHookAt ? when(status.lastHookAt) : 'None yet'} />
          <Row label="Orders tracked" value={String(status.orders)} last />

          <p style={{
            fontSize: '.82rem', color: 'var(--muted)', lineHeight: 1.55,
            marginTop: '.9rem', paddingTop: '.9rem', borderTop: '1px solid var(--border)',
          }}>
            {status.explanation}
          </p>

          {status.state === 'pending' && (
            <p style={{ fontSize: '.78rem', color: 'var(--warning)', marginTop: '.6rem' }}>
              This page checks every few seconds — you do not need to reload it.
            </p>
          )}
        </div>
      )}

      {/* Setup first, form second: Shopify only reveals the signing secret
          after the webhooks exist, so asking for it up front asks for
          something the brand cannot have yet. */}
      <button
        className="type-switch-btn"
        onClick={() => setShowSetup(v => !v)}
        style={{ marginBottom: showSetup ? '1rem' : '1.5rem' }}
      >
        {showSetup ? 'Hide setup steps' : connected ? 'Show setup steps again' : 'Show me how →'}
      </button>

      {showSetup && (
        <div className="panel-section" style={{ marginBottom: '1.5rem' }}>
          <Step n="1" title="Create four webhooks in Shopify">
            <p style={para}>
              In Shopify: <strong>Settings → Notifications → Webhooks → Create webhook</strong>.
              Format <strong>JSON</strong>. Create one for each event below, all pointing at
              the same URL.
            </p>

            <Copyable value={WEBHOOK_URL} copied={copied === 'url'} onCopy={() => copy(WEBHOOK_URL, 'url')} />

            <ul style={{ margin: '.8rem 0 0', paddingLeft: '1.1rem', fontSize: '.84rem', color: 'var(--tan)' }}>
              {WEBHOOK_EVENTS.map(e => (
                <li key={e.topic} style={{ marginBottom: '.3rem' }}>
                  <strong style={{ color: 'var(--warm-white)' }}>{e.topic}</strong> — {e.why}
                </li>
              ))}
            </ul>
          </Step>

          <Step n="2" title="Copy the signing secret">
            <p style={para}>
              Once all four are saved, Shopify shows a <strong>signing secret</strong> on that
              page. That is what proves an order really came from your store — treat it
              like a password. Paste it into the form below.
            </p>
          </Step>

          <Step n="3" title="Add one snippet to your theme" optional>
            <p style={para}>
              Optional but recommended. Shopify already records the page a shopper
              arrived on, so a purchase in the same visit is attributed without this.
              The snippet remembers the creator for 30 days, so a shopper who browses
              around or comes back later still counts.
            </p>
            <p style={para}>
              <strong>Online Store → Themes → Edit code → layout/theme.liquid</strong>,
              just before <code>&lt;/head&gt;</code>.
            </p>
            <Copyable
              value={themeSnippet()}
              copied={copied === 'snippet'}
              onCopy={() => copy(themeSnippet(), 'snippet')}
              block
            />
          </Step>
        </div>
      )}

      <form onSubmit={submit} className="panel-section">
        <h3 style={{ fontSize: '.95rem', marginBottom: '.9rem' }}>
          {connected ? 'Replace the signing secret' : 'Connect your store'}
        </h3>

        <label style={lbl} htmlFor="shop-domain">Your Shopify domain</label>
        <input
          id="shop-domain"
          value={domain}
          onChange={e => { setDomain(e.target.value); setError('') }}
          placeholder="yourstore.myshopify.com"
          autoComplete="off"
          spellCheck="false"
          style={inp}
        />
        <p style={hint}>
          The permanent <code>.myshopify.com</code> one, not your custom domain — that
          is what Shopify puts on every webhook.
        </p>

        <label style={{ ...lbl, marginTop: '1rem' }} htmlFor="shop-secret">Signing secret</label>
        <input
          id="shop-secret"
          type="password"
          value={secret}
          onChange={e => { setSecret(e.target.value); setError('') }}
          placeholder="from Settings → Notifications → Webhooks"
          autoComplete="off"
          style={inp}
        />
        <p style={hint}>
          Stored encrypted and never shown again — not even to you. If you lose it,
          regenerate it in Shopify and paste the new one here.
        </p>

        <div style={{ display: 'flex', gap: '.6rem', marginTop: '1.2rem', flexWrap: 'wrap' }}>
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : connected ? 'Update secret' : 'Connect store'}
          </button>
          {connected && (
            <button className="type-switch-btn" type="button" disabled={busy} onClick={disconnect}>
              Disconnect
            </button>
          )}
        </div>
      </form>
    </>
  )
}

const para = { fontSize: '.84rem', color: 'var(--tan)', lineHeight: 1.6, margin: '0 0 .6rem' }
const lbl  = { display: 'block', fontSize: '.8rem', color: 'var(--muted)', marginBottom: '.35rem' }
const inp  = { width: '100%', maxWidth: '26rem' }
const hint = { fontSize: '.76rem', color: 'var(--muted)', margin: '.35rem 0 0', lineHeight: 1.5 }

function Row({ label, value, mono, last }) {
  return (
    <div style={{
      display: 'flex', gap: '1rem', padding: '.5rem 0',
      borderBottom: last ? 'none' : '1px solid var(--border)', fontSize: '.86rem',
    }}>
      <span style={{ width: 130, flexShrink: 0, color: 'var(--muted)' }}>{label}</span>
      <span style={{
        color: 'var(--warm-white)', wordBreak: 'break-all',
        fontFamily: mono ? 'ui-monospace, monospace' : 'inherit',
      }}>{value}</span>
    </div>
  )
}

function Step({ n, title, optional, children }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', gap: '.6rem', alignItems: 'baseline', marginBottom: '.5rem' }}>
        <span style={{
          fontSize: '.72rem', fontWeight: 700, color: 'var(--ink-deep)',
          background: 'var(--sage)', borderRadius: 999, padding: '.1rem .5rem',
        }}>{n}</span>
        <strong style={{ fontSize: '.9rem' }}>{title}</strong>
        {optional && (
          <span style={{ fontSize: '.72rem', color: 'var(--muted)' }}>optional</span>
        )}
      </div>
      <div style={{ paddingLeft: '1.8rem' }}>{children}</div>
    </div>
  )
}

function Copyable({ value, copied, onCopy, block }) {
  return (
    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', marginTop: '.5rem' }}>
      <code style={{
        flex: 1, minWidth: 0, display: 'block', background: 'var(--ink-deep)',
        border: '1px solid var(--border)', borderRadius: 8, padding: '.6rem .7rem',
        fontSize: block ? '.72rem' : '.78rem', color: 'var(--sage)',
        whiteSpace: block ? 'pre' : 'nowrap',
        overflowX: 'auto', maxHeight: block ? '14rem' : 'none',
      }}>{value}</code>
      <button type="button" className="type-switch-btn" onClick={onCopy} style={{ flexShrink: 0 }}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
