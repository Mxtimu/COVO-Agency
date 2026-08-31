import { supabase } from '../supabase'

// Minimum confirmed balance before a creator may request a withdrawal. Keeps
// payout fees proportionate to the amount being moved.
export const MIN_PAYOUT = 250

// Paystack transfers are not wired yet, so nothing can actually move money.
// AdminPayouts already refused to create payout rows for that reason, but the
// creator-facing button stayed live: a creator could request a withdrawal,
// watch their available balance drop by it — requestPayout() reserves the
// commissions — and then wait indefinitely for a transfer no code path can
// initiate. Showing someone their money leaving for a queue nobody drains is
// worse than telling them payouts are not open yet.
//
// One flag, read by both sides, so they cannot drift apart again. Flip it when
// the Paystack transfer integration lands.
export const PAYOUTS_ENABLED = false

const one = v => (Array.isArray(v) ? v[0] : v)

// Everything the creator dashboard needs, in one round trip per table.
// Commissions are the source of truth for money; clicks for traffic.
export async function fetchCreatorStats(creatorId) {
  if (!creatorId) return null

  const [{ data: commissions }, { count: clickCount }, { data: applications }, { data: payouts }] =
    await Promise.all([
      supabase
        .from('commissions')
        .select('id, net_commission, gross_commission, sale_amount, commission_rate, status, created_at, confirms_at, campaign_id, campaigns:campaign_id(title)')
        .eq('creator_id', creatorId)
        .order('created_at', { ascending: false }),
      supabase
        .from('clicks')
        .select('id', { count: 'exact', head: true })
        .eq('creator_id', creatorId),
      supabase
        .from('campaign_applications')
        .select('campaign_id, status')
        .eq('creator_id', creatorId)
        .eq('status', 'approved'),
      supabase
        .from('payouts')
        .select('id, amount, status, created_at, processed_at')
        .eq('creator_id', creatorId)
        .order('created_at', { ascending: false }),
    ])

  const rows = commissions ?? []

  // 'denied' never counts toward anything a creator can see as earned.
  const live = rows.filter(c => c.status !== 'denied')

  const sum = (list) => list.reduce((t, c) => t + Number(c.net_commission || 0), 0)

  const pending   = live.filter(c => c.status === 'pending')
  const confirmed = live.filter(c => c.status === 'confirmed')
  const paid      = live.filter(c => c.status === 'paid')
  const held      = live.filter(c => c.status === 'held')

  const clicks      = clickCount ?? 0
  const conversions = live.length

  // Confirmed but not yet paid, and not already inside a pending payout
  // request — this is what a creator can actually withdraw right now.
  const pendingPayoutTotal = (payouts ?? [])
    .filter(p => p.status === 'pending' || p.status === 'processing')
    .reduce((t, p) => t + Number(p.amount || 0), 0)

  const available = Math.max(0, sum(confirmed) - pendingPayoutTotal)

  // Earnings grouped by campaign, biggest first.
  const byCampaign = Object.values(
    live.reduce((acc, c) => {
      const key = c.campaign_id ?? 'unknown'
      acc[key] ??= { id: key, label: one(c.campaigns)?.title ?? 'Campaign', amount: 0 }
      acc[key].amount += Number(c.net_commission || 0)
      return acc
    }, {}),
  ).sort((a, b) => b.amount - a.amount)

  const topAmount = byCampaign[0]?.amount ?? 0
  for (const b of byCampaign) b.pct = topAmount ? Math.round((b.amount / topAmount) * 100) : 0

  const avgRate = live.length
    ? live.reduce((t, c) => t + Number(c.commission_rate || 0), 0) / live.length * 100
    : 0

  return {
    commissions: rows,
    payouts:     payouts ?? [],
    totalEarned: sum(live),
    pending:     sum(pending),
    confirmed:   sum(confirmed),
    paid:        sum(paid),
    held:        sum(held),
    available,
    pendingPayoutTotal,
    clicks,
    conversions,
    convRate:        clicks ? (conversions / clicks) * 100 : 0,
    activeCampaigns: (applications ?? []).length,
    avgRate,
    byCampaign,
    confirmedIds:    confirmed.map(c => c.id),
  }
}

// The amount is deliberately not passed: request_creator_payout() computes it
// from confirmed, unclaimed commissions inside the database. A client-supplied
// figure could be forged, so the browser only gets to ask, never to say how much.
export async function requestPayout() {
  const { data, error } = await supabase.rpc('request_creator_payout')
  return { data: Array.isArray(data) ? data[0] : data, error }
}

export function formatZAR(n) {
  return `R${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)    return 'just now'
  if (mins < 60)   return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)    return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  if (days < 30)   return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString('en-ZA')
}
