import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../context/AppContext'

// Raising and tracking disputes, for creators and brands alike.
//
// The database has allowed this since the beginning — schema_full.sql has
// `users insert disputes` with `WITH CHECK (raised_by = auth.uid())` and
// `users read own disputes` beside it. Only the form was missing, so the
// disputes table was admin-only in practice: an admin could resolve a
// dispute nobody had any way to raise.
//
// It matters beyond the product. Paystack's onboarding asked how COVO
// manages disputes, and "an admin can edit a table" is not an answer.
//
// One component for both dashboards: a brand reporting an unsafe placement
// and a creator querying a denied commission are the same record with a
// different `type`, and splitting them would mean two forms drifting apart.
// `audience` only changes which types are offered and the wording.

const TYPES = {
  creator: [
    { id: 'commission_denial', label: 'A commission was denied',
      hint: 'A sale you made was refused or reversed and you think that is wrong.' },
    { id: 'unconfirmed_sale',  label: 'A sale was never recorded',
      hint: 'Someone bought through your link but nothing appeared in your earnings.' },
    { id: 'brand_safety',      label: 'A problem with a brand',
      hint: 'A brand asked for something you are not comfortable with, or the products are not as described.' },
    { id: 'other',             label: 'Something else',
      hint: 'Anything that does not fit above.' },
  ],
  brand: [
    { id: 'unconfirmed_sale',  label: 'A commission looks wrong',
      hint: 'A commission was charged that you do not believe should have been.' },
    { id: 'brand_safety',      label: 'A problem with a creator',
      hint: 'A creator misrepresented your product or posted something against your guidelines.' },
    { id: 'other',             label: 'Something else',
      hint: 'Anything that does not fit above.' },
  ],
}

const STATUS_STYLE = {
  open:         { label: 'Open',         color: 'var(--warning)', bg: 'rgba(245,158,11,.12)' },
  under_review: { label: 'Under review', color: 'var(--warning)', bg: 'rgba(245,158,11,.12)' },
  resolved:     { label: 'Resolved',     color: 'var(--sage)',    bg: 'rgba(122,154,122,.14)' },
  dismissed:    { label: 'Dismissed',    color: 'var(--muted)',   bg: 'rgba(255,255,255,.06)' },
}

// Enough that the description says something an admin can act on. A dispute
// reading "its wrong" costs a round trip to ask what happened.
const MIN_DESCRIPTION = 30

export default function Disputes({ audience = 'creator' }) {
  const { session } = useApp()
  const [disputes, setDisputes] = useState(null)
  const [error,    setError]    = useState('')
  const [open,     setOpen]     = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [type,     setType]     = useState('')
  const [body,     setBody]     = useState('')
  const [sent,     setSent]     = useState('')

  const types = TYPES[audience] ?? TYPES.creator

  const load = useCallback(async () => {
    // campaigns(title) resolves because disputes.campaign_id is a real FK to
    // campaigns. A profiles embed is deliberately absent — the person
    // reading this IS raised_by, so there is nothing to look up.
    const { data, error: err } = await supabase
      .from('disputes')
      .select('id, type, description, status, resolution_notes, created_at, campaigns(title)')
      .order('created_at', { ascending: false })

    if (err) {
      // Surfaced rather than swallowed: an empty list and a failed query
      // look identical otherwise, and "no disputes" is a reassuring thing
      // to show someone whose dispute failed to load.
      console.error('[disputes] load failed', err)
      setError('Could not load your reports. Please refresh.')
      setDisputes([])
      return
    }
    setError('')
    setDisputes(data ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  async function submit(e) {
    e.preventDefault()
    setError('')

    if (!type) return setError('Please choose what the problem is about.')
    if (body.trim().length < MIN_DESCRIPTION) {
      return setError(`Please describe what happened in a little more detail — at least ${MIN_DESCRIPTION} characters, so we can look into it without having to ask.`)
    }

    setSaving(true)
    const { error: err } = await supabase.from('disputes').insert({
      // raised_by is what the RLS policy checks, so it must be the caller.
      // The insert is refused outright if this is anyone else.
      raised_by:   session?.user?.id,
      type,
      description: body.trim(),
    })
    setSaving(false)

    if (err) {
      console.error('[disputes] insert failed', err)
      setError(err.message || 'Could not submit your report. Please try again.')
      return
    }

    setType(''); setBody(''); setOpen(false)
    setSent('Report submitted. We will look into it and reply here with what we found.')
    load()
  }

  return (
    <>
      <div className="panel-header">
        <h2>Reports &amp; disputes</h2>
      </div>

      <p className="sub" style={{ marginBottom: '1.25rem', maxWidth: '38rem', lineHeight: 1.55 }}>
        {audience === 'brand'
          ? 'Tell us about a commission that looks wrong or a problem with a creator. We review every report and reply with what we found.'
          : 'If a commission was denied, a sale never showed up, or something about a brand is not right, report it here. We review every report and reply with what we found.'}
      </p>

      {error && <div className="error-banner"   style={{ marginBottom: '1rem' }}>{error}</div>}
      {sent  && <div className="success-banner" style={{ marginBottom: '1rem' }}>{sent}</div>}

      {!open ? (
        <button className="btn-primary" onClick={() => { setOpen(true); setError(''); setSent('') }}>
          Report a problem
        </button>
      ) : (
        <form onSubmit={submit} className="panel-section" style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '.82rem', color: 'var(--muted)', marginBottom: '.4rem' }}>
            What is this about?
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', marginBottom: '1rem' }}>
            {types.map(t => (
              <label
                key={t.id}
                style={{
                  display: 'flex', gap: '.6rem', alignItems: 'flex-start',
                  padding: '.6rem .7rem', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${type === t.id ? 'var(--sage)' : 'var(--border)'}`,
                  background: type === t.id ? 'rgba(122,154,122,.08)' : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="dispute-type"
                  value={t.id}
                  checked={type === t.id}
                  onChange={() => { setType(t.id); setError('') }}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <span style={{ display: 'block', fontSize: '.88rem', color: 'var(--warm-white)' }}>{t.label}</span>
                  <span style={{ display: 'block', fontSize: '.78rem', color: 'var(--muted)', lineHeight: 1.45 }}>{t.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <label style={{ display: 'block', fontSize: '.82rem', color: 'var(--muted)', marginBottom: '.4rem' }}>
            What happened?
          </label>
          <textarea
            value={body}
            onChange={e => { setBody(e.target.value); setError('') }}
            rows={5}
            placeholder="Dates, order numbers, campaign names — anything that helps us find it."
            style={{ width: '100%', resize: 'vertical' }}
          />
          <div style={{
            fontSize: '.74rem', marginTop: '.3rem',
            color: body.trim().length >= MIN_DESCRIPTION ? 'var(--muted)' : 'var(--warning)',
          }}>
            {body.trim().length} characters
            {body.trim().length < MIN_DESCRIPTION && ` — ${MIN_DESCRIPTION - body.trim().length} more needed`}
          </div>

          <div style={{ display: 'flex', gap: '.6rem', marginTop: '1rem' }}>
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? 'Submitting…' : 'Submit report'}
            </button>
            <button
              className="type-switch-btn"
              type="button"
              disabled={saving}
              onClick={() => { setOpen(false); setError(''); setType(''); setBody('') }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <h3 style={{ margin: '1.75rem 0 .75rem', fontSize: '.95rem' }}>Your reports</h3>

      {disputes === null ? (
        <p style={{ fontSize: '.85rem', color: 'var(--muted)' }}>Loading…</p>
      ) : disputes.length === 0 ? (
        <p style={{ fontSize: '.85rem', color: 'var(--muted)' }}>
          You have not reported anything. That is a good sign.
        </p>
      ) : (
        disputes.map(d => {
          const s = STATUS_STYLE[d.status] ?? STATUS_STYLE.open
          const label = (TYPES[audience] ?? TYPES.creator).find(t => t.id === d.type)?.label
                     ?? d.type.replace('_', ' ')
          return (
            <div
              key={d.id}
              className="panel-section"
              style={{ marginBottom: '.75rem', borderLeft: `3px solid ${s.color}` }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 650, fontSize: '.88rem' }}>{label}</div>
                  <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.15rem' }}>
                    {new Date(d.created_at).toLocaleDateString('en-ZA', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                    {d.campaigns?.title ? ` · ${d.campaigns.title}` : ''}
                  </div>
                </div>
                <span style={{
                  fontSize: '.72rem', padding: '.2rem .55rem', borderRadius: 999,
                  whiteSpace: 'nowrap', background: s.bg, color: s.color,
                }}>{s.label}</span>
              </div>

              <p style={{ fontSize: '.84rem', marginTop: '.6rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {d.description}
              </p>

              {d.resolution_notes && (
                <div style={{
                  marginTop: '.7rem', paddingTop: '.7rem',
                  borderTop: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginBottom: '.2rem' }}>
                    What we found
                  </div>
                  <p style={{ fontSize: '.84rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {d.resolution_notes}
                  </p>
                </div>
              )}
            </div>
          )
        })
      )}
    </>
  )
}
