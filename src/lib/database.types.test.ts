// ════════════════════════════════════════════════════════════════════
// Compile-time regression tests for the generated schema types.
//
// There is no test runner here. `@ts-expect-error` IS the assertion: it
// fails the build if the line below it does NOT error. So `npm run
// typecheck` passing means every bad query in this file is still rejected,
// and every good one still compiles.
//
// These reproduce the two real bugs that shipped in BrandCreators.jsx and
// went unnoticed until a panel rendered empty in production. Both were
// invisible in plain JS: PostgREST answers a malformed select with an error
// object, supabase-js hands back `data: null`, and `(data ?? []).map(...)`
// renders nothing at all rather than throwing.
//
// One caveat learned by testing it rather than assuming: the error is
// encoded into the *result type*, so it only becomes a compile error when
// the value is actually used. Fetching a broken embed and ignoring it stays
// silent. That is why the checks below consume what they select.
// ════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'

// ── Bug 1: embedding a table there is no foreign key to ──────────────
// affiliate_links.creator_id references profiles, not creator_profiles.
// Every FK in this schema points at profiles — none point at
// creator_profiles or brand_profiles — so this relation cannot resolve.
// Resolves to: SelectQueryError<"could not find the relation between
// affiliate_links and creator_profiles">
export async function rejectsUnrelatedEmbed() {
  const { data } = await supabase
    .from('affiliate_links')
    .select('id, creator_profiles(covo_score)')
  // @ts-expect-error creator_profiles is not reachable from affiliate_links
  return data?.[0]?.creator_profiles?.covo_score
}

// The same mistake on the brand side, which is the one recorded in
// covo-postgrest-brand-profile-embeds: campaigns.brand_id is a FK to
// profiles, so PostgREST resolves the alias to profiles and fails on the
// missing column.
export async function rejectsBrandProfileEmbed() {
  const { data } = await supabase
    .from('campaigns')
    .select('id, brand_profiles(company_name)')
  // @ts-expect-error brand_profiles is not reachable from campaigns
  return data?.[0]?.brand_profiles?.company_name
}

// ── Bug 2: a column renamed out from under the query ─────────────────
// escrow_functions.sql renamed short_code to slug. BrandCreators kept
// selecting short_code for weeks.
export async function rejectsRenamedColumn() {
  const { data } = await supabase
    .from('affiliate_links')
    .select('id, short_code')
  // @ts-expect-error short_code was renamed to slug
  return data?.[0]?.short_code
}

// ── The shapes that must keep working ────────────────────────────────
// If a migration breaks one of these, typecheck fails here rather than in
// a dashboard panel that silently renders nothing.
export async function acceptsCorrectQueries() {
  const links = await supabase
    .from('affiliate_links')
    .select('id, slug, discount_code, profiles(full_name, email)')

  const commissions = await supabase
    .from('commissions')
    .select('id, net_commission, status, confirms_at, campaigns:campaign_id(title)')

  const escrow = await supabase
    .from('campaign_escrow')
    .select('id, balance, total_deposited, status, campaigns(title)')

  return {
    slug:    links.data?.[0]?.slug,
    creator: links.data?.[0]?.profiles?.full_name,
    net:     commissions.data?.[0]?.net_commission,
    title:   commissions.data?.[0]?.campaigns?.title,
    balance: escrow.data?.[0]?.balance,
  }
}

// ── The money columns this codebase depends on ───────────────────────
// Referencing them by name means a rename or drop surfaces here at build
// time. lib/api/creator.ts reads every one of these.
type Commission = Database['public']['Tables']['commissions']['Row']
import type { Database } from './database.types'

const _moneyColumns: Array<keyof Commission> = [
  'net_commission', 'gross_commission', 'platform_fee', 'sale_amount',
  'commission_rate', 'status', 'confirms_at', 'return_window_days',
  'external_order_id', 'creator_id', 'campaign_id',
]
void _moneyColumns
