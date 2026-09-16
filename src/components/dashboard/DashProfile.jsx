import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useApp } from '../../context/AppContext'
import CovoScore from './CovoScore'
import PayoutDetails from './PayoutDetails'
import Icon from '../ui/Icon'

const ALL_NICHES = [
  { id: 'sports',    icon: 'fitness', label: 'Sports & Fitness' },
  { id: 'wellness',  icon: 'wellness', label: 'Wellness'         },
  { id: 'hygiene',   icon: 'health', label: 'Personal Care'    },
  { id: 'fashion',   icon: 'fashion', label: 'Fashion & Style'  },
  { id: 'food',      icon: 'food', label: 'Food & Drink'     },
  { id: 'tech',      icon: 'tech', label: 'Technology'       },
  { id: 'travel',    icon: 'travel', label: 'Travel'           },
  { id: 'gaming',    icon: 'gaming', label: 'Gaming'           },
  { id: 'beauty',    icon: 'beauty', label: 'Beauty & Skincare'},
  { id: 'lifestyle', icon: 'nature', label: 'Lifestyle'        },
  { id: 'business',  icon: 'trending', label: 'Business'         },
  { id: 'education', icon: 'books', label: 'Education'        },
  { id: 'parenting', icon: 'parenting', label: 'Parenting'        },
  { id: 'music',     icon: 'tiktok', label: 'Music'            },
  { id: 'pets',      icon: 'pets', label: 'Pets'             },
  { id: 'home',      icon: 'home', label: 'Home & Decor'     },
]

const GENDERS   = ['Male', 'Female', 'Non-binary', 'Prefer not to say']
const COUNTRIES = ['United Kingdom','United States','South Africa','Nigeria','Kenya','Ghana','Canada','Australia','Germany','France','Netherlands','Sweden','Brazil','India','UAE','Other']

function SaveCancel({ onSave, onCancel, saving, disabled }) {
  return (
    <div style={{ display: 'flex', gap: '.5rem' }}>
      <button onClick={onSave} disabled={saving || disabled}
        style={{ background: 'var(--sage)', border: 'none', color: 'var(--ink-deep)', fontSize: '.75rem', padding: '.3rem .8rem', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 700 }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button onClick={onCancel}
        style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', fontSize: '.75rem', padding: '.3rem .8rem', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
        Cancel
      </button>
    </div>
  )
}

function SuccessBanner({ text }) {
  return (
    <div style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)', color: '#6ee7b7', padding: '.5rem .85rem', borderRadius: 8, fontSize: '.8rem', marginBottom: '.75rem' }}>
      {text}
    </div>
  )
}

function ErrorBanner({ text }) {
  return (
    <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#FCA5A5', padding: '.5rem .85rem', borderRadius: 8, fontSize: '.8rem', marginBottom: '.75rem', lineHeight: 1.5 }}>
      Could not save: {text}
    </div>
  )
}

export default function DashProfile({ user, profile }) {
  const { session } = useApp()

  const cp = Array.isArray(profile?.creator_profiles)
    ? profile.creator_profiles[0]
    : profile?.creator_profiles

  const initials = ((user?.first?.[0] || '') + (user?.last?.[0] || '')).toUpperCase() || '?'
  const fullName = `${user?.first || ''} ${user?.last || ''}`.trim() || 'Creator'

  // ── Account details edit state ─────────────────────────────────────────────
  const [editingDetails, setEditingDetails] = useState(false)
  const [details, setDetails] = useState({
    location:       cp?.location       || '',
    gender:         cp?.gender         || '',
    bio:            cp?.bio            || '',
    primary_handle: cp?.primary_handle || '',
  })
  const [savingDetails, setSavingDetails] = useState(false)
  const [savedDetails,  setSavedDetails]  = useState(false)
  // Shared by both save paths below — a failed write has to be visible,
  // not just absent.
  const [saveError,     setSaveError]     = useState('')

  function openDetails() {
    setDetails({
      location:       cp?.location       || '',
      gender:         cp?.gender         || '',
      bio:            cp?.bio            || '',
      primary_handle: cp?.primary_handle || '',
    })
    setEditingDetails(true)
  }

  // "Profile updated successfully" used to appear whether or not the write
  // succeeded, and the form closed either way — so a failed save looked
  // exactly like a good one until the next reload put the old values back.
  async function saveDetails() {
    if (!session?.user?.id) return
    setSavingDetails(true)
    setSaveError('')
    const { error } = await supabase.from('creator_profiles').upsert({
      id: session.user.id,
      ...details,
    })
    setSavingDetails(false)

    if (error) {
      // The form stays open with their text in it — closing it would lose
      // what they typed on top of not having saved it.
      setSaveError(error.message)
      return
    }

    setSavedDetails(true)
    setEditingDetails(false)
    setTimeout(() => setSavedDetails(false), 2500)
  }

  // ── Niches edit state ─────────────────────────────────────────────────────
  const [editingNiches, setEditingNiches] = useState(false)
  const [selected,      setSelected]      = useState(cp?.niches || [])
  const [savingNiches,  setSavingNiches]  = useState(false)
  const [savedNiches,   setSavedNiches]   = useState(false)

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(n => n !== id) : [...prev, id])
  }

  async function saveNiches() {
    if (!session?.user?.id) return
    setSavingNiches(true)
    setSaveError('')
    const { error } = await supabase.from('creator_profiles').upsert({
      id: session.user.id,
      niches: selected,
    })
    setSavingNiches(false)

    if (error) {
      setSaveError(error.message)
      return
    }

    setSavedNiches(true)
    setEditingNiches(false)
    setTimeout(() => setSavedNiches(false), 2500)
  }

  const set = k => e => setDetails(d => ({ ...d, [k]: e.target.value }))

  return (
    <>
      <h2 style={{ fontSize: '1.3rem', fontWeight: 800, letterSpacing: '-.015em', marginBottom: '1.5rem' }}>My Profile</h2>

      {/* Above the fold, and full width. Brands and admins could see this
          number from the day it was built; the creator it describes could
          not see it anywhere. */}
      <div style={{ marginBottom: '1.25rem' }}>
        <CovoScore />
      </div>

      {/* Where the money actually goes. Sits above the profile fields
          because a creator with cleared earnings and no bank account has
          one thing to do here, and it is this. */}
      <div style={{ marginBottom: '1.25rem' }}>
        <PayoutDetails />
      </div>

      <div className="two-col">

        {/* ── Account Details ── */}
        <div className="panel-section">
          <h3>
            Account Details
            {!editingDetails ? (
              <button onClick={openDetails}
                style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--sage)', fontSize: '.75rem', padding: '.3rem .8rem', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>
                Edit
              </button>
            ) : (
              <SaveCancel onSave={saveDetails} onCancel={() => setEditingDetails(false)} saving={savingDetails} />
            )}
          </h3>

          {savedDetails && <SuccessBanner text="Profile updated successfully." />}
          {saveError && <ErrorBanner text={saveError} />}

          {/* Avatar row — always visible */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', background: 'var(--dark3)', borderRadius: 10, marginBottom: '1rem' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', fontWeight: 800, flexShrink: 0, color: 'white' }}>
              {initials}
            </div>
            <div>
              <div style={{ fontWeight: 700 }}>{fullName}</div>
              <div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>{user?.email || ''}</div>
            </div>
          </div>

          {editingDetails ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Gender</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', marginTop: '.35rem' }}>
                  {GENDERS.map(g => (
                    <button key={g} type="button"
                      onClick={() => setDetails(d => ({ ...d, gender: g }))}
                      className={`gender-btn ${details.gender === g ? 'selected' : ''}`}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Country / Location</label>
                <select value={details.location} onChange={set('location')}>
                  <option value="">Select your country</option>
                  {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Bio</label>
                <textarea placeholder="Tell brands what makes your content unique…" value={details.bio} onChange={set('bio')} style={{ minHeight: 80 }} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Primary social handle</label>
                <input type="text" placeholder="@yourusername" value={details.primary_handle} onChange={set('primary_handle')} />
              </div>
            </div>
          ) : (
            [
              ['Location',   cp?.location       || 'Not set'],
              ['Gender',      cp?.gender         || 'Not set'],
              ['Bio',        cp?.bio            || 'Not set'],
              ['Handle',     cp?.primary_handle || 'Not set'],
              ['Role',       profile?.role === 'brand' ? 'Brand' : 'Creator'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '.65rem 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--muted)', fontSize: '.82rem' }}>{k}</span>
                <span style={{ fontSize: '.82rem', textAlign: 'right', maxWidth: '60%' }}>{v}</span>
              </div>
            ))
          )}
        </div>

        {/* ── Niches & Interests ── */}
        <div className="panel-section">
          <h3>
            Niche &amp; Interests
            {!editingNiches ? (
              <button onClick={() => { setSelected(cp?.niches || []); setEditingNiches(true) }}
                style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--sage)', fontSize: '.75rem', padding: '.3rem .8rem', borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600 }}>
                Edit
              </button>
            ) : (
              <SaveCancel onSave={saveNiches} onCancel={() => setEditingNiches(false)} saving={savingNiches} disabled={selected.length === 0} />
            )}
          </h3>

          {savedNiches && <SuccessBanner text="Niches updated successfully." />}
          {saveError && <ErrorBanner text={saveError} />}

          {editingNiches ? (
            <>
              <p style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: '.75rem' }}>Tap to select or deselect. Select at least 1.</p>
              <div className="niche-grid">
                {ALL_NICHES.map(n => (
                  <div key={n.id} className={`niche-pill ${selected.includes(n.id) ? 'selected' : ''}`} onClick={() => toggle(n.id)}>
                    <span><Icon name={n.icon} size={16} /></span><span>{n.label}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '.5rem' }}>
              {(cp?.niches || []).length > 0 ? (cp.niches).map(id => {
                const n = ALL_NICHES.find(x => x.id === id)
                return (
                  <span key={id} style={{ padding: '.35rem .85rem', background: 'rgba(195,206,148,.1)', border: '1px solid rgba(195,206,148,.25)', borderRadius: 100, fontSize: '.8rem', color: 'var(--sage)' }}>
                    {n ? <><Icon name={n.icon} size={13} /> {n.label}</> : id}
                  </span>
                )
              }) : (
                <span style={{ color: 'var(--muted)', fontSize: '.875rem' }}>No niches selected yet. Click <strong>Edit</strong> to add your interests.</span>
              )}
            </div>
          )}
        </div>

      </div>
    </>
  )
}
