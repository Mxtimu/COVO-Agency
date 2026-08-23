import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import Icon from '../../../components/ui/Icon'

export default function AdminCampaigns() {
  const [campaigns, setCampaigns] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [busy,      setBusy]      = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('campaigns')
      .select('id, title, status, brand_id, created_at, profiles(full_name), campaign_escrow(id, balance, status, total_deposited)')
      .order('created_at', { ascending: false })
    setCampaigns(data ?? [])
    setLoading(false)
  }

  // Approving is what puts a campaign in front of creators — RLS only exposes
  // campaigns with status 'active' to them. The escrow row is created here
  // because every downstream money operation looks it up by campaign_id.
  async function approve(campaign) {
    setBusy(campaign.id)

    const { error: escrowError } = await supabase.from('campaign_escrow').upsert({
      campaign_id: campaign.id,
      brand_id:    campaign.brand_id,
      status:      'active',
    }, { onConflict: 'campaign_id' })

    if (escrowError) { setBusy(null); return alert(`Could not create escrow: ${escrowError.message}`) }

    const { error } = await supabase.from('campaigns').update({ status: 'active' }).eq('id', campaign.id)
    setBusy(null)
    if (error) return alert(`Could not approve campaign: ${error.message}`)
    load()
  }

  function escrow(c) {
    const raw = c.campaign_escrow
    return Array.isArray(raw) ? raw[0] : raw
  }

  async function togglePause(campaign) {
    const esc = escrow(campaign)
    if (!esc) return
    const newStatus = esc.status === 'paused' ? 'active' : 'paused'
    await Promise.all([
      supabase.from('campaign_escrow').update({ status: newStatus }).eq('id', esc.id),
      supabase.from('campaigns').update({ status: newStatus }).eq('id', campaign.id),
    ])
    setCampaigns(prev => prev.map(c => c.id !== campaign.id ? c : {
      ...c, status: newStatus,
      campaign_escrow: { ...(escrow(c) ?? {}), status: newStatus },
    }))
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Loading campaigns…</p>

  return (
    <>
      <div className="page-header">
        <h2>Campaigns</h2>
      </div>

      <div className="panel-section" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
            <thead>
              <tr style={{ background: 'var(--dark3)', textAlign: 'left' }}>
                {['Campaign','Brand','Status','Escrow Balance','Deposited','Escrow Status','Actions'].map(h => (
                  <th key={h} style={{ padding: '.75rem 1rem', color: 'var(--muted)', fontWeight: 600, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No campaigns yet.</td></tr>
              )}
              {campaigns.map(c => {
                const esc     = escrow(c)
                const balance = esc?.balance ?? 0
                const low     = balance > 0 && balance < 500

                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '.75rem 1rem', fontWeight: 600, maxWidth: 200 }}>{c.title}</td>
                    <td style={{ padding: '.75rem 1rem', color: 'var(--muted)' }}>{c.profiles?.full_name || '—'}</td>
                    <td style={{ padding: '.75rem 1rem' }}>
                      <span className={`status-badge ${c.status}`}>{c.status}</span>
                    </td>
                    <td style={{ padding: '.75rem 1rem', color: low ? 'var(--warning)' : balance === 0 ? 'var(--muted)' : 'var(--success)', fontWeight: 700 }}>
                      {esc ? `R${Number(balance).toFixed(2)}` : 'No escrow'}
                      {low && <Icon name="warning" size={13} style={{ marginLeft: '.3rem', verticalAlign: 'text-bottom' }} />}
                    </td>
                    <td style={{ padding: '.75rem 1rem', color: 'var(--muted)' }}>
                      {esc ? `R${Number(esc.total_deposited ?? 0).toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding: '.75rem 1rem' }}>
                      {esc ? (
                        <span style={{
                          padding: '.2rem .6rem', borderRadius: 100, fontSize: '.72rem', fontWeight: 600,
                          background: esc.status === 'active' ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.12)',
                          color: esc.status === 'active' ? 'var(--success)' : 'var(--warning)',
                        }}>{esc.status}</span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '.75rem 1rem', display: 'flex', gap: '.4rem' }}>
                      {c.status === 'pending' && (
                        <button onClick={() => approve(c)} disabled={busy === c.id}
                          style={{ background: 'rgba(16,185,129,.12)', border: 'none', color: 'var(--success)', padding: '.25rem .6rem', borderRadius: 6, cursor: busy === c.id ? 'wait' : 'pointer', fontSize: '.72rem', fontWeight: 600 }}>
                          {busy === c.id ? 'Approving…' : 'Approve'}
                        </button>
                      )}
                      {esc && (
                        <button onClick={() => togglePause(c)}
                          style={{ background: esc.status === 'paused' ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.12)', border: 'none', color: esc.status === 'paused' ? 'var(--success)' : 'var(--warning)', padding: '.25rem .6rem', borderRadius: 6, cursor: 'pointer', fontSize: '.72rem', fontWeight: 600 }}>
                          {esc.status === 'paused' ? 'Resume' : 'Pause'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
