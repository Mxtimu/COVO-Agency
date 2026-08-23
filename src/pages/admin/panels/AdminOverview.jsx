import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import Icon from '../../../components/ui/Icon'

export default function AdminOverview() {
  const [stats, setStats] = useState({ creators: 0, brands: 0, campaigns: 0, disputes: 0, pendingCommissions: 0 })

  useEffect(() => {
    async function load() {
      const [creators, brands, campaigns, disputes, commissions] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'creator'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'brand'),
        supabase.from('campaigns').select('id', { count: 'exact', head: true }),
        supabase.from('disputes').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('commissions').select('net_commission').eq('status', 'confirmed'),
      ])
      const pendingTotal = (commissions.data ?? []).reduce((s, c) => s + Number(c.net_commission), 0)
      setStats({
        creators:            creators.count   ?? 0,
        brands:              brands.count     ?? 0,
        campaigns:           campaigns.count  ?? 0,
        disputes:            disputes.count   ?? 0,
        pendingCommissions:  pendingTotal,
      })
    }
    load()
  }, [])

  const cards = [
    { label: 'Total Creators',       val: stats.creators,                         color: 'var(--sage)'    },
    { label: 'Total Brands',         val: stats.brands,                           color: 'var(--lilac)'   },
    { label: 'Campaigns',            val: stats.campaigns,                        color: 'var(--tan)'     },
    { label: 'Open Disputes',        val: stats.disputes,                         color: 'var(--warning)' },
    { label: 'Confirmed Commissions Owed', val: `R${stats.pendingCommissions.toFixed(2)}`, color: 'var(--success)' },
  ]

  return (
    <>
      <div className="greeting">
        <h1>Admin Overview</h1>
        <p>Platform health at a glance — COVO Phase 1 (Invite-only)</p>
      </div>
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))' }}>
        {cards.map(c => (
          <div className="stat-card" key={c.label}>
            <div className="stat-card-label">{c.label}</div>
            <div className="stat-card-val" style={{ color: c.color }}>{c.val}</div>
          </div>
        ))}
      </div>

      <div className="panel-section" style={{ marginTop: '1.5rem' }}>
        <h3>Phase 1 Checklist</h3>
        {[
          [true,  'Supabase Auth — email + OAuth'],
          [true,  'Creator onboarding + guardrail acknowledgement'],
          [true,  'Affiliate link format: covo.africa/r/[brand]-[creator]'],
          [true,  'Campaign escrow schema'],
          [true,  'Commissions schema (pending → confirmed → paid)'],
          [false, 'Paystack payment integration (escrow deposits)'],
          [false, 'Paystack Transfer API (creator payouts)'],
          [false, 'Email notifications via Resend'],
          [false, 'Tracking pixel snippet for brand confirmation pages'],
          [false, 'Wave invitations — automated Phase 2'],
        ].map(([done, label]) => (
          <div key={label} style={{ display: 'flex', gap: '.75rem', padding: '.5rem 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <span style={{ color: done ? 'var(--success)' : 'var(--muted)', fontSize: '.95rem' }}>{done ? <Icon name="check" size={15} /> : <Icon name="clock" size={15} />}</span>
            <span style={{ fontSize: '.85rem', color: done ? 'var(--warm-white)' : 'var(--muted)' }}>{label}</span>
          </div>
        ))}
      </div>
    </>
  )
}
