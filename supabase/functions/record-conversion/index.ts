import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const PLATFORM_FEE_RATE = 0.08   // COVO takes 8% of gross commission
const MIN_ESCROW_BALANCE = 500   // ZAR — below this the campaign pauses

// Called from the brand's Shopify order-confirmation page. Public by
// necessity: it runs in a shopper's browser on the brand's domain, so there
// is no COVO session to authenticate. Safety comes from the fact that it can
// only ever create a commission against a real affiliate link and a real
// order id, and the unique constraint makes replays idempotent.
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const ref       = String(body.ref ?? '').trim()
    const orderId   = String(body.order_id ?? '').trim()
    const rawAmount = Number(body.order_value)
    const currency  = String(body.currency ?? 'ZAR').toUpperCase()

    if (!ref)     return json({ error: 'Missing ref' }, 400)
    if (!orderId) return json({ error: 'Missing order_id' }, 400)
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return json({ error: 'order_value must be a positive number' }, 400)
    }

    // Round to cents up front; floating point order totals otherwise leak
    // fractions of a cent into every downstream calculation.
    const saleAmount = Math.round(rawAmount * 100) / 100

    // ── Resolve the link and its campaign ────────────────────────────
    const { data: link } = await supabase
      .from('affiliate_links')
      .select('id, creator_id, campaign_id, product_id')
      .eq('id', ref)
      .single()

    if (!link) return json({ error: 'Unknown ref' }, 404)

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, status, commission_rate, return_window_days')
      .eq('id', link.campaign_id)
      .single()

    if (!campaign) return json({ error: 'Campaign not found' }, 404)

    // A paused or closed campaign should not keep accruing commission the
    // brand has not funded.
    if (campaign.status !== 'active') {
      return json({ recorded: false, reason: `Campaign is ${campaign.status}` }, 200)
    }

    // ── Money ────────────────────────────────────────────────────────
    const rate  = Number(campaign.commission_rate)          // stored as a fraction, e.g. 0.10
    const gross = round2(saleAmount * rate)
    const fee   = round2(gross * PLATFORM_FEE_RATE)
    const net   = round2(gross - fee)

    const windowDays = campaign.return_window_days ?? 14
    const confirmsAt = new Date(Date.now() + windowDays * 86_400_000).toISOString()

    // Most recent click on this link, so the commission traces back to the
    // visit that produced it.
    const { data: lastClick } = await supabase
      .from('clicks')
      .select('id')
      .eq('affiliate_link_id', link.id)
      .order('clicked_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: commission, error } = await supabase
      .from('commissions')
      .insert({
        creator_id:        link.creator_id,
        campaign_id:       link.campaign_id,
        product_id:        link.product_id,
        affiliate_link_id: link.id,
        click_id:          lastClick?.id ?? null,
        external_order_id: orderId,
        sale_amount:       saleAmount,
        currency,
        commission_rate:   rate,
        gross_commission:  gross,
        platform_fee:      fee,
        net_commission:    net,
        status:            'pending',
        return_window_days: windowDays,
        confirms_at:       confirmsAt,
      })
      .select('id')
      .single()

    if (error) {
      // 23505 = unique violation on (campaign_id, external_order_id): this
      // order was already recorded. A refreshed confirmation page must not
      // pay the creator twice, so treat it as success.
      if (error.code === '23505') {
        return json({ recorded: false, reason: 'Order already recorded' }, 200)
      }
      console.error('commission insert failed:', error.message)
      return json({ error: 'Could not record conversion' }, 500)
    }

    // ── Low-escrow guard ─────────────────────────────────────────────
    // Warn early rather than discovering at payout time that the campaign
    // cannot cover what it has promised.
    const { data: escrow } = await supabase
      .from('campaign_escrow')
      .select('id, balance, status')
      .eq('campaign_id', link.campaign_id)
      .maybeSingle()

    if (escrow && escrow.status === 'active' && Number(escrow.balance) < MIN_ESCROW_BALANCE) {
      await supabase.from('campaign_escrow').update({
        status: 'paused',
        low_balance_notified_at: new Date().toISOString(),
      }).eq('id', escrow.id)
      await supabase.from('campaigns').update({ status: 'paused' }).eq('id', link.campaign_id)
    }

    return json({
      recorded:       true,
      commission_id:  commission.id,
      net_commission: net,
      confirms_at:    confirmsAt,
    })
  } catch (e) {
    console.error(e)
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
