import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createHmac }   from 'https://deno.land/std@0.168.0/node/crypto.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)
const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY')!

serve(async (req) => {
  // ── 1. Verify Paystack HMAC signature ─────────────────────────────
  const body      = await req.text()
  const signature = req.headers.get('x-paystack-signature') ?? ''
  const expected  = createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex')
  if (signature !== expected) {
    return new Response('Unauthorized', { status: 401 })
  }

  const event = JSON.parse(body)

  // ── 2. Handle charge.success (brand escrow deposit) ──────────────
  if (event.event === 'charge.success') {
    const ref    = event.data.reference as string
    const amount = event.data.amount / 100  // Paystack sends in kobo/cents

    // Paystack retries a webhook until it gets a 200, and will redeliver
    // after a timeout even when the first attempt succeeded. Matching on
    // the reference alone returned the tranche every time, so a retry
    // credited the escrow twice. Claiming the row by moving it out of
    // 'pending' makes the second delivery match nothing.
    const { data: tranche } = await supabase
      .from('escrow_tranches')
      .update({ paystack_status: 'success', deposited_at: new Date().toISOString() })
      .eq('paystack_reference', ref)
      .eq('paystack_status', 'pending')
      .select('escrow_id, amount')
      .maybeSingle()

    if (tranche) {
      // Add to escrow balance
      await supabase.rpc('increment_escrow_balance', {
        p_escrow_id: tranche.escrow_id,
        p_amount:    amount,
      })

      const { data: escrow } = await supabase
        .from('campaign_escrow')
        .select('balance, status, campaign_id')
        .eq('id', tranche.escrow_id)
        .single()

      if (escrow) {
        // Commissions earned while the campaign was underfunded were
        // parked as 'held'. This deposit is what pays for them, so
        // release what it covers — oldest creator first — before
        // deciding whether the campaign can reopen.
        const { error: releaseError } = await supabase.rpc('release_held_commissions', {
          p_campaign_id: escrow.campaign_id,
        })
        if (releaseError) console.error('release_held_commissions failed:', releaseError.message)

        // Check if campaign was paused due to low balance — resume it
        if (escrow.status === 'paused' && escrow.balance >= 500) {
          await supabase.from('campaign_escrow').update({ status: 'active' }).eq('id', tranche.escrow_id)
          await supabase.from('campaigns').update({ status: 'active' }).eq('id', escrow.campaign_id)
        }
      }
    }
  }

  // ── 3. Handle transfer.success (creator payout) ──────────────────
  if (event.event === 'transfer.success') {
    const ref = event.data.reference as string
    await supabase.from('payouts')
      .update({ status: 'success', processed_at: new Date().toISOString() })
      .eq('paystack_reference', ref)

    // Mark commissions as paid
    const { data: payout } = await supabase
      .from('payouts').select('commission_ids').eq('paystack_reference', ref).single()
    if (payout?.commission_ids?.length) {
      // Only confirmed commissions become paid. Without the status filter
      // a redelivered transfer.success could drag a commission that had
      // since been disputed and denied back into 'paid'.
      await supabase.from('commissions')
        .update({ status: 'paid' })
        .in('id', payout.commission_ids)
        .eq('status', 'confirmed')
    }
  }

  // ── 4. Handle transfer.failed ─────────────────────────────────────
  if (event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
    const ref    = event.data.reference as string
    const status = event.event === 'transfer.reversed' ? 'reversed' : 'failed'
    await supabase.from('payouts').update({ status }).eq('paystack_reference', ref)
  }

  return new Response('OK', { status: 200 })
})
