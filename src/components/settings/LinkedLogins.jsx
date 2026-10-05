import { useState, useEffect, useCallback } from 'react'
import {
  OAUTH_PROVIDERS,
  listLinkedIdentities,
  linkProvider,
  unlinkProvider,
  identityErrorMessage,
} from '../../lib/api/auth'
import { ProviderMark } from '../ui/BrandMark'

// Lets an account that signed up by email attach Google or Facebook and sign
// in with it afterwards.
//
// Brands sign up by email on purpose — the signup form collects a first and
// last name, and an OAuth signup would give us the provider's display name
// instead. That left brands typing a password forever with no way to use the
// social buttons, which is what this fixes: link here, then the buttons on
// the brand login screen work.
//
// `email` is an identity too, and it is usually the only one. It is listed so
// the count is honest, but it is never offered for removal here — Supabase
// refuses to delete a user's last identity, and removing the password login
// while no social login is attached would lock them out of their own account.
export default function LinkedLogins() {
  const [identities, setIdentities] = useState(null)
  const [busy,       setBusy]       = useState(null)
  const [error,      setError]      = useState('')
  const [notice,     setNotice]     = useState('')

  const load = useCallback(async () => {
    const { identities: list, error: err } = await listLinkedIdentities()
    if (err) {
      setError(identityErrorMessage(err))
      setIdentities([])
      return
    }
    setIdentities(list)
  }, [])

  useEffect(() => { load() }, [load])

  async function link(providerId, label) {
    setBusy(providerId); setError(''); setNotice('')
    // Comes back to this page rather than the dashboard root.
    const { error: err } = await linkProvider(providerId, '/dashboard/brand')
    if (err) {
      setBusy(null)
      setError(identityErrorMessage(err, label))
    }
    // On success the browser leaves for the provider, so there is nothing to
    // clear — the busy state goes away with the page.
  }

  async function unlink(identity, label) {
    setBusy(identity.identity_id); setError(''); setNotice('')
    const { error: err } = await unlinkProvider(identity)
    setBusy(null)
    if (err) {
      setError(identityErrorMessage(err, label))
      return
    }
    setNotice(`${label} was removed from this account.`)
    load()
  }

  if (identities === null) {
    return (
      <div className="panel-section" style={{ marginTop: '1rem' }}>
        <h3 style={{ marginBottom: '.75rem' }}>Sign-in methods</h3>
        <p style={{ fontSize: '.85rem', color: 'var(--muted)' }}>Loading…</p>
      </div>
    )
  }

  const linked   = new Set(identities.map(i => i.provider))
  const social   = OAUTH_PROVIDERS.filter(p => p.enabled)
  // Only a social identity can be unlinked, and only while something else
  // remains to sign in with.
  const canUnlink = identities.length > 1

  return (
    <div className="panel-section" style={{ marginTop: '1rem' }}>
      <h3 style={{ marginBottom: '.35rem' }}>Sign-in methods</h3>
      <p style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: '.9rem', lineHeight: 1.5 }}>
        Add a social login so you do not have to type a password. Your email and
        password keep working either way.
      </p>

      {error  && <div className="error-banner"   style={{ marginBottom: '.75rem' }}>{error}</div>}
      {notice && <div className="success-banner" style={{ marginBottom: '.75rem' }}>{notice}</div>}

      <div style={{ fontSize: '.875rem' }}>
        {identities.some(i => i.provider === 'email') && (
          <Row
            label="Email and password"
            mark={<span style={{ fontSize: '1rem' }}>@</span>}
            status="In use"
          />
        )}

        {social.map(p => {
          const identity = identities.find(i => i.provider === p.id)
          return (
            <Row
              key={p.id}
              label={p.label}
              mark={<ProviderMark provider={p.id} />}
              status={identity ? 'Connected' : null}
              action={
                identity
                  ? canUnlink && (
                      <button
                        className="type-switch-btn"
                        disabled={busy === identity.identity_id}
                        onClick={() => unlink(identity, p.label)}
                      >
                        {busy === identity.identity_id ? 'Removing…' : 'Remove'}
                      </button>
                    )
                  : (
                      <button
                        className="type-switch-btn"
                        disabled={busy !== null}
                        onClick={() => link(p.id, p.label)}
                      >
                        {busy === p.id ? 'Opening…' : 'Connect'}
                      </button>
                    )
              }
            />
          )
        })}
      </div>
    </div>
  )
}

function Row({ label, mark, status, action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '.75rem',
      padding: '.6rem 0', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', width: 20, flexShrink: 0 }}>{mark}</span>
      <span style={{ color: 'var(--warm-white)', flex: 1 }}>{label}</span>
      {status && <span style={{ color: 'var(--sage)', fontSize: '.78rem' }}>{status}</span>}
      {action}
    </div>
  )
}
