import { supabase } from '../supabase'
import type { Database } from '../database.types'

type Commission = Database['public']['Tables']['commissions']['Row']
type Payout     = Database['public']['Tables']['payouts']['Row']

// Minimum confirmed balance before a creator may request a withdrawal. Keeps
// payout fees proportionate to the amount being moved.
//
// The database is the authority here: public.min_payout() in
// creator_payouts.sql. This copy exists so the UI can explain the rule
// without a round trip, and test_money_paths.sql asserts the two agree —
// because the failure mode of a stale copy is silent and nasty, a
// dashboard that invites a creator to withdraw R220 and a database that
// then refuses it with no explanation they can act on.
export const MIN_PAYOUT = 200

// Paystack transfers are wired: a creator registers a bank account, which
// Paystack verifies and returns a recipient for, and an admin sends the
// payout against it from AdminPayouts. Settlement comes back through
// mark_payout_settled on the transfer.success webhook.
//
// One flag, read by both sides, so they cannot drift apart. It was false for
// as long as nothing could move money — a creator could otherwise request a
// withdrawal, watch their available balance drop by it (requestPayout()
// reserves the commissions), and wait indefinitely for a transfer no code
// path could initiate.
export const PAYOUTS_ENABLED = true

// PostgREST returns an embedded 1-to-1 as either an object or a single-element
// array depending on how it resolved the relationship, so every read of one
// goes through this.
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  (Array.isArray(v) ? v[0] ?? null : v ?? null)

// The subset of a commission this module reads. Derived from the generated Row
// type rather than restated, so dropping or renaming a column downstream is a
// compile error here instead of a silent undefined in the earnings totals.
type CommissionRow = Pick<
  Commission,
  'id' | 'net_commission' | 'gross_commission' | 'sale_amount' | 'commission_rate'
  | 'status' | 'created_at' | 'confirms_at' | 'campaign_id'
> & { campaigns: { title: string } | { title: string }[] | null }

export interface CampaignEarnings {
  id: string
  label: string
  amount: number
  pct: number
}

export interface CreatorStats {
  commissions: CommissionRow[]
  payouts: Pick<Payout, 'id' | 'amount' | 'status' | 'created_at' | 'processed_at'>[]
  totalEarned: number
  pending: number
  confirmed: number
  paid: number
  held: number
  available: number
  pendingPayoutTotal: number
  clicks: number
  conversions: number
  convRate: number
  activeCampaigns: number
  avgRate: number
  byCampaign: CampaignEarnings[]
  confirmedIds: string[]
}

// Everything the creator dashboard needs, in one round trip per table.
// Commissions are the source of truth for money; clicks for traffic.
export async function fetchCreatorStats(creatorId: string | null | undefined): Promise<CreatorStats | null> {
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

  const rows = (commissions ?? []) as unknown as CommissionRow[]

  // 'denied' never counts toward anything a creator can see as earned.
  const live = rows.filter(c => c.status !== 'denied')

  const sum = (list: CommissionRow[]) =>
    list.reduce((t, c) => t + Number(c.net_commission || 0), 0)

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
  const grouped = live.reduce<Record<string, CampaignEarnings>>((acc, c) => {
    const key = c.campaign_id ?? 'unknown'
    acc[key] ??= { id: key, label: one(c.campaigns)?.title ?? 'Campaign', amount: 0, pct: 0 }
    acc[key]!.amount += Number(c.net_commission || 0)
    return acc
  }, {})

  const byCampaign = Object.values(grouped).sort((a, b) => b.amount - a.amount)

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

export function formatZAR(n: number | string | null | undefined): string {
  return `R${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
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
