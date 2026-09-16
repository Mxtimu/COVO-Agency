import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import { formatZAR, MIN_PAYOUT } from '../../lib/api/creator'
import { SA_BANKS } from '../../data/banks'
import Icon from '../ui/Icon'

// Where a creator registers the account they want to be paid into.
//
// The account number goes to Paystack and is not stored here. Paystack pays
// a recipient_code, not an account number — the details are exchanged once
// and every transfer afterwards references that code. So COVO keeps the
// code and the last four digits, which is enough for someone to recognise
// their own account and useless to anybody else.
export default function PayoutDetails() {
  const { session } = useApp()
  const [ready,   setReady]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')
  const [saved,   setSaved]   = useState(false)
  const [form,    setForm]    = useState({ bank_code: '', account_number: '', account_name: '' })

  useEffect(() => { load() }, [session?.user?.id])

  async function load() {
    if (!session?.user?.id) return
    setLoading(true)
    const { data, error: err } = await supabase.rpc('payout_readiness', { p_creator: session.user.id })
    if (err) setError(err.message)
    else setReady(Array.isArray(data) ? data[0] : data)
    setLoading(false)
  }

  const setF = k => e => { setError(''); setForm(f => ({ ...f, [k]: e.target.value })) }

  async function save(e) {
    e.preventDefault()
    if (!form.bank_code)      return setError('Please choose your bank.')
    if (!form.account_name.trim()) return setError('Please enter the account holder name.')
    if (!/^\d{6,14}$/.test(form.account_number.replace(/\s/g, ''))) {
      return setError('That does not look like a valid account number.')
    }

    setBusy(true); setError('')
    const { data: { session: s } } = await supabase.auth.getSession()

    // The Edge Function talks to Paystack, which verifies the account before
    // returning a recipient. An invalid number is refused there, not here.
    const { data, error: fnError } = await supabase.functions.invoke('paystack-create-recipient', {
      body: {
        bank_code:      form.bank_code,
        account_number: form.account_number.replace(/\s/g, ''),
        account_name:   form.account_name.trim(),
      },
      headers: { Authorization: `Bearer ${s?.access_token}` },
    })
    setBusy(false)

    if (fnError || data?.error) {
      return setError(data?.error ?? fnError?.message ?? 'Could not save your payout details.')
    }

    setForm({ bank_code: '', account_number: '', account_name: '' })
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 4000)
    load()
  }

  if (loading) {
    return (
      <div className="panel-section">
        <h3>Payout Details</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Loading…</p>
      </div>
    )
  }

  const hasRecipient = ready?.has_recipient
  const confirmed    = Number(ready?.confirmed_total ?? 0)

  return (
    <div className="panel-section">
      <h3>
        Payout Details
        {hasRecipient && !editing && (
          <button onClick={() => { setEditing(true); setError('') }}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--sage)', fontSize: '.75rem', padding: '.3rem .8rem', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>
            Change
          </button>
        )}
      </h3>

      {saved && (
        <div style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)', color: '#6ee7b7', padding: '.5rem .85rem', borderRadius: 8, fontSize: '.8rem', marginBottom: '.75rem' }}>
          Bank account verified and saved.
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#FCA5A5', padding: '.5rem .85rem', borderRadius: 8, fontSize: '.8rem', marginBottom: '.75rem', lineHeight: 1.5 }}>
          {error}
        </div>
      )}

      {hasRecipient && !editing ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.9rem', padding: '.9rem 1rem', background: 'var(--dark3)', borderRadius: 10 }}>
            <Icon name="money" size={20} style={{ color: 'var(--sage)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '.9rem' }}>{ready.bank_name || 'Bank account'}</div>
              <div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>
                {ready.account_name} · ••••{ready.account_last4}
              </div>
            </div>
            <Icon name="verified" size={16} style={{ color: 'var(--success)' }} />
          </div>

          <p style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.75rem', lineHeight: 1.55 }}>
            We only keep the last four digits — your full account number stays with
            our payment provider, so it is not ours to lose.
          </p>
        </>
      ) : (
        <form onSubmit={save}>
          {!hasRecipient && (
            <p style={{ fontSize: '.82rem', color: 'var(--muted)', marginBottom: '1rem', lineHeight: 1.55 }}>
              Add the account you want your earnings paid into. We verify it with
              our payment provider before saving, so a typo is caught now rather
              than when you are waiting on money.
            </p>
          )}

          <div className="form-group">
            <label>Bank</label>
            <select value={form.bank_code} onChange={setF('bank_code')}>
              <option value="">Choose your bank</option>
              {SA_BANKS.map(b => <option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Account holder name</label>
            <input type="text" placeholder="As it appears on your bank account"
              value={form.account_name} onChange={setF('account_name')} />
          </div>

          <div className="form-group">
            <label>Account number</label>
            <input type="text" inputMode="numeric" placeholder="Your account number"
              value={form.account_number} onChange={setF('account_number')} autoComplete="off" />
          </div>

          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.25rem' }}>
            <button type="submit" disabled={busy}
              style={{ background: 'var(--gradient)', border: 'none', color: 'white', padding: '.5rem 1.15rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer', fontWeight: 700, fontSize: '.82rem', fontFamily: 'var(--font-sans)' }}>
              {busy ? 'Verifying…' : hasRecipient ? 'Save new account' : 'Verify and save'}
            </button>
            {hasRecipient && (
              <button type="button" onClick={() => { setEditing(false); setError('') }}
                style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', padding: '.5rem 1.15rem', borderRadius: 8, cursor: 'pointer', fontSize: '.82rem', fontFamily: 'var(--font-sans)' }}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {/* What they are waiting on, stated plainly next to the account it
          would be paid into. */}
      <div style={{ marginTop: '1.15rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', fontSize: '.82rem', color: 'var(--muted)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--warm-white)' }}>{formatZAR(confirmed)}</strong> cleared and ready.{' '}
        {!hasRecipient
          ? 'Add a bank account above so it can be paid out.'
          : confirmed >= MIN_PAYOUT
            ? `You can request a withdrawal from the Earnings page.`
            : `Withdrawals start at ${formatZAR(MIN_PAYOUT)}.`}
      </div>
    </div>
  )
}
