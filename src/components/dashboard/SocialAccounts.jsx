import { useState } from 'react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabase'
import Icon from '../ui/Icon'

// Where a creator says which accounts are theirs.
//
// tiktok_handle, instagram_handle and youtube_handle have been in the schema
// since the first migration and nothing has ever written to them — the same
// shape as affiliate_links.clicks, a column that looks authoritative and is
// permanently null. Brands have therefore been choosing creators with no idea
// where their audience actually is.
//
// These are self-reported. Verified connection — reading follower counts and
// engagement from TikTok and Instagram directly — needs OAuth apps that do
// not exist yet, and Supabase has no provider for either, so it will be a
// custom flow. There is deliberately no "Connect" button here in the
// meantime: a control that does nothing is worse than an honest text field.
const PLATFORMS = [
  {
    key:    'tiktok_handle',
    label:  'TikTok',
    icon:   'tiktok',
    prefix: 'tiktok.com/@',
    hint:   '@yourhandle',
  },
  {
    key:    'instagram_handle',
    label:  'Instagram',
    icon:   'instagram',
    prefix: 'instagram.com/',
    hint:   '@yourhandle',
  },
  {
    key:    'youtube_handle',
    label:  'YouTube',
    icon:   'video',
    prefix: 'youtube.com/@',
    hint:   '@yourchannel',
  },
]

// Creators paste whole URLs far more often than bare handles, and a stored
// "https://www.tiktok.com/@name?lang=en" makes a useless profile link.
function normaliseHandle(raw) {
  let v = (raw ?? '').trim()
  if (!v) return ''

  // Strip a full or partial URL down to the last path segment.
  v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  if (v.includes('/')) {
    const parts = v.split('?')[0].split('/').filter(Boolean)
    v = parts[parts.length - 1] ?? ''
  }

  return v.replace(/^@+/, '').trim()
}

export default function SocialAccounts({ profile }) {
  const { session } = useApp()

  const cp = Array.isArray(profile?.creator_profiles)
    ? profile.creator_profiles[0]
    : profile?.creator_profiles

  const [editing, setEditing] = useState(false)
  const [form,    setForm]    = useState({})
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')
  const [saved,   setSaved]   = useState(false)

  function open() {
    setForm(Object.fromEntries(PLATFORMS.map(p => [p.key, cp?.[p.key] ?? ''])))
    setError('')
    setEditing(true)
  }

  async function save() {
    if (!session?.user?.id) return
    setBusy(true); setError('')

    const cleaned = Object.fromEntries(
      PLATFORMS.map(p => [p.key, normaliseHandle(form[p.key]) || null]),
    )

    const { error: err } = await supabase.from('creator_profiles')
      .upsert({ id: session.user.id, ...cleaned })
    setBusy(false)

    if (err) return setError(err.message)

    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const filled = PLATFORMS.filter(p => cp?.[p.key])

  return (
    <div className="panel-section">
      <h3>
        Your Accounts
        {!editing ? (
          <button onClick={open}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--sage)', fontSize: '.75rem', padding: '.3rem .8rem', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>
            {filled.length ? 'Edit' : 'Add'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button onClick={save} disabled={busy}
              style={{ background: 'var(--sage)', border: 'none', color: 'var(--ink-deep)', fontSize: '.75rem', padding: '.3rem .8rem', borderRadius: 7, cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 700 }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => { setEditing(false); setError('') }}
              style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: '.75rem', padding: '.3rem .8rem', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
              Cancel
            </button>
          </div>
        )}
      </h3>

      {saved && (
        <div style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)', color: '#6ee7b7', padding: '.5rem .85rem', borderRadius: 8, fontSize: '.8rem', marginBottom: '.75rem' }}>
          Accounts updated.
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#FCA5A5', padding: '.5rem .85rem', borderRadius: 8, fontSize: '.8rem', marginBottom: '.75rem', lineHeight: 1.5 }}>
          Could not save: {error}
        </div>
      )}

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          <p style={{ fontSize: '.82rem', color: 'var(--muted)', lineHeight: 1.55, margin: 0 }}>
            Brands see these when reviewing your application. Paste a handle or a
            full profile link — either works.
          </p>
          {PLATFORMS.map(p => (
            <div className="form-group" style={{ marginBottom: 0 }} key={p.key}>
              <label><Icon name={p.icon} size={13} style={{ verticalAlign: 'text-bottom', marginRight: '.35rem' }} />{p.label}</label>
              <input
                type="text"
                id={`social-${p.key}`}
                placeholder={p.hint}
                value={form[p.key] ?? ''}
                onChange={e => { setError(''); setForm(f => ({ ...f, [p.key]: e.target.value })) }}
                autoComplete="off"
              />
            </div>
          ))}
        </div>
      ) : filled.length === 0 ? (
        <p style={{ fontSize: '.85rem', color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
          No accounts added yet. Brands reviewing your application can't see where
          your audience is — adding them is the quickest way to make an
          application stronger.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {PLATFORMS.map(p => {
            const handle = cp?.[p.key]
            if (!handle) return null
            return (
              <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: '.7rem', padding: '.6rem .8rem', background: 'var(--dark3)', borderRadius: 9 }}>
                <Icon name={p.icon} size={16} style={{ color: 'var(--sage)', flexShrink: 0 }} />
                <span style={{ fontSize: '.84rem', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>@{handle}</span>
                <a
                  href={`https://${p.prefix}${handle}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{ color: 'var(--sage)', fontSize: '.74rem', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
                >
                  View →
                </a>
              </div>
            )
          })}
        </div>
      )}

      <p style={{ fontSize: '.76rem', color: 'var(--muted)', marginTop: '1rem', paddingTop: '.85rem', borderTop: '1px solid var(--border)', lineHeight: 1.55 }}>
        These are as you've given them. Connecting accounts directly — so
        follower counts and engagement feed your COVO Score automatically — is
        coming, and will replace this.
      </p>
    </div>
  )
}
