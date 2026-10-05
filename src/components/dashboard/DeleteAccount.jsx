import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { invokeFunction } from '../../lib/api/functions'
import Icon from '../ui/Icon'

// Closing an account.
//
// The blockers are fetched before the button is shown, not after it is
// pressed, because "you cannot do this, and here is the money that is why"
// is a useful thing to learn while deciding — and being refused after
// working up to a confirmation is not.
export default function DeleteAccount() {
  const navigate = useNavigate()
  const { session, logout } = useApp()

  const [blockers, setBlockers] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [open,     setOpen]     = useState(false)
  const [confirm,  setConfirm]  = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!session?.user?.id) return
      const { data, error: err } = await supabase
        .rpc('account_deletion_blockers', { p_user: session.user.id })
      if (cancelled) return
      if (err) setError(err.message)
      else setBlockers(data ?? [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [session?.user?.id])

  async function remove() {
    setBusy(true); setError('')
    const { data, error: err } = await invokeFunction('delete-account', { confirm: 'DELETE' })
    setBusy(false)

    if (err) return setError(err)

    // Signed out locally either way — the session is dead server-side.
    await logout()
    navigate('/?closed=1', { replace: true })
    if (data?.warning) console.warn(data.warning)
  }

  if (loading) return null

  const blocked = blockers.length > 0

  return (
    <div className="panel-section" style={{ borderLeft: '3px solid rgba(239,68,68,.5)', marginTop: '1.25rem' }}>
      <h3 style={{ color: '#FCA5A5' }}>Close your account</h3>

      {error && (
        <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#FCA5A5', padding: '.5rem .85rem', borderRadius: 8, fontSize: '.8rem', marginBottom: '.85rem', lineHeight: 1.5 }}>
          {error}
        </div>
      )}

      {blocked ? (
        <>
          <p style={{ fontSize: '.84rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '.75rem' }}>
            You can't close your account while there's money in flight. Closing it
            wouldn't settle what's owed — it would just remove the person it's
            owed to.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {blockers.map(b => (
              <div key={b.blocker} style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-start', padding: '.6rem .8rem', background: 'var(--dark3)', borderRadius: 8, fontSize: '.82rem' }}>
                <Icon name="warning" size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '.15rem' }} />
                <span>{b.detail}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.75rem' }}>
            Once these clear, this option becomes available. Email
            support@covo.africa if something looks stuck.
          </p>
        </>
      ) : !open ? (
        <>
          <p style={{ fontSize: '.84rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '1rem' }}>
            This removes your name, email, phone, bank details and social handles
            permanently. Records of sales you've already been paid for are kept —
            they're part of the brands' accounts too, and we're required to hold
            them.
          </p>
          <button
            onClick={() => { setOpen(true); setError('') }}
            style={{ background: 'transparent', border: '1px solid rgba(239,68,68,.35)', color: '#FCA5A5', padding: '.5rem 1.15rem', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '.82rem', fontFamily: 'var(--font-sans)' }}
          >
            Close my account
          </button>
        </>
      ) : (
        <>
          <p style={{ fontSize: '.84rem', color: 'var(--warm-white)', lineHeight: 1.6, marginBottom: '.85rem' }}>
            This cannot be undone. Type <strong>DELETE</strong> to confirm.
          </p>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              value={confirm}
              onChange={e => { setError(''); setConfirm(e.target.value) }}
              placeholder="DELETE"
              aria-label="Type DELETE to confirm"
              style={{ flex: '0 1 160px', padding: '.5rem .8rem', background: 'var(--dark3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--warm-white)', fontSize: '.85rem', fontFamily: 'var(--font-sans)' }}
            />
            <button
              onClick={remove}
              disabled={busy || confirm.trim().toUpperCase() !== 'DELETE'}
              style={{ background: confirm.trim().toUpperCase() === 'DELETE' ? 'rgba(239,68,68,.15)' : 'var(--dark3)', border: '1px solid rgba(239,68,68,.35)', color: '#FCA5A5', padding: '.5rem 1.15rem', borderRadius: 8, cursor: busy ? 'wait' : confirm.trim().toUpperCase() === 'DELETE' ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '.82rem', fontFamily: 'var(--font-sans)', opacity: confirm.trim().toUpperCase() === 'DELETE' ? 1 : .5 }}
            >
              {busy ? 'Closing…' : 'Permanently close'}
            </button>
            <button
              onClick={() => { setOpen(false); setConfirm(''); setError('') }}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', padding: '.5rem 1.15rem', borderRadius: 8, cursor: 'pointer', fontSize: '.82rem', fontFamily: 'var(--font-sans)' }}
            >
              Keep my account
            </button>
          </div>
        </>
      )}
    </div>
  )
}
