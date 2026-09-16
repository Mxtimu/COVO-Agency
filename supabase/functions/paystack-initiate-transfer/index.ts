import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Admin-triggered: send a pending payout to Paystack as a transfer.
//
// The ordering here is the whole point. The payout is claimed in the
// database BEFORE the Paystack call, with the reference already decided, so
// that:
//
//   * two admins clicking at the same moment cannot both initiate a transfer
//     for the same payout — the second claim matches nothing;
//   * if the API call succeeds but the response is lost, the transfer exists
//     under a reference the database already knows, so the webhook still
//     settles it rather than arriving as a stranger.
//
// If the call genuinely fails the claim is released, because a payout stuck
// in 'processing' has no transfer to settle it and no way out:
// request_creator_payout() treats processing as money already spoken for, so
// the creator's earnings would be frozen with nothing able to move them.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (!PAYSTACK_SECRET) {
    console.error('PAYSTACK_SECRET_KEY is not set')
    return json({ error: 'Payouts are not configured yet.' }, 503)
  }

  let payoutId = ''

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return json({ error: 'Not authenticated' }, 401)

    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: userError } = await caller.auth.getUser()
    if (userError || !user) return json({ error: 'Not authenticated' }, 401)

    const { data: profile, error: roleError } = await supabase
      .from('profiles').select('role').eq('id', user.id).single()

    if (roleError) {
      console.error('role lookup failed:', roleError.message)
      return json({ error: 'Could not verify your permissions. Please try again.' }, 503)
    }
    if (profile?.role !== 'admin') {
      return json({ error: 'Only COVO admins can initiate payouts.' }, 403)
    }

    const body = await req.json()
    payoutId = String(body.payout_id ?? '').trim()
    if (!payoutId) return json({ error: 'payout_id is required' }, 400)

    // ── Resolve the payout and the creator's recipient ──────────────
    const { data: payout, error: payoutError } = await supabase
      .from('payouts')
      .select('id, creator_id, amount, status')
      .eq('id', payoutId)
      .single()

    if (payoutError) throw new Error(`payout lookup: ${payoutError.message}`)
    if (!payout) return json({ error: 'No such payout.' }, 404)
    if (payout.status !== 'pending') {
      return json({ error: `This payout is already ${payout.status}.` }, 409)
    }

    const { data: creator, error: creatorError } = await supabase
      .from('creator_profiles')
      .select('paystack_recipient_code, bank_account_last4')
      .eq('id', payout.creator_id)
      .single()

    if (creatorError) throw new Error(`creator lookup: ${creatorError.message}`)
    if (!creator?.paystack_recipient_code) {
      return json({
        error: 'This creator has not registered their bank details yet, so there is nowhere to send the money.',
      }, 409)
    }

    const amount = Number(payout.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ error: `Payout amount is unusable: ${payout.amount}` }, 400)
    }

    // ── Claim before calling out ────────────────────────────────────
    const reference = `COVO-PO-${payoutId.slice(0, 8)}-${Date.now()}`

    const { data: claimData, error: claimError } = await supabase.rpc('claim_payout_for_transfer', {
      p_payout_id:     payoutId,
      p_transfer_code: '',     // filled in below once Paystack answers
      p_reference:     reference,
    })

    if (claimError) throw new Error(`claim_payout_for_transfer: ${claimError.message}`)

    const claim = Array.isArray(claimData) ? claimData[0] : claimData
    if (!claim?.claimed) {
      return json({ error: claim?.outcome ?? 'Could not claim this payout.' }, 409)
    }

    // ── Send it ─────────────────────────────────────────────────────
    const res = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        source:    'balance',
        amount:    Math.round(amount * 100),   // cents
        recipient: creator.paystack_recipient_code,
        reason:    'COVO creator earnings',
        reference,
      }),
    })

    const result = await res.json().catch(() => ({}))

    if (!res.ok || !result?.status) {
      const message = result?.message ?? `Paystack refused the transfer (${res.status})`
      console.error('transfer refused:', message)
      await releaseClaim(payoutId, message)
      return json({ error: message }, 400)
    }

    const transferCode  = result.data?.transfer_code ?? ''
    const paystackState = result.data?.status ?? 'unknown'

    // Record the transfer code against the claim we already made.
    const { error: codeError } = await supabase
      .from('payouts')
      .update({ paystack_transfer_code: transferCode })
      .eq('id', payoutId)

    if (codeError) {
      // The transfer is real and in flight — do NOT release the claim.
      // The webhook settles on reference, which was recorded before the
      // call, so losing the code costs traceability, not the payment.
      console.error(`transfer ${reference} sent but code not recorded:`, codeError.message)
    }

    // 'otp' means the Paystack account requires a one-time code to release
    // transfers. The money has not moved and no webhook will arrive until
    // it is confirmed, so say so plainly rather than reporting success.
    if (paystackState === 'otp') {
      return json({
        initiated:   true,
        needs_otp:   true,
        reference,
        transfer_code: transferCode,
        message: 'Paystack is holding this transfer for OTP confirmation. Approve it in the Paystack dashboard, or disable OTP for transfers under Settings → Preferences to send them straight through.',
      })
    }

    console.log(`transfer ${reference}: R${amount} to ****${creator.bank_account_last4 ?? '????'} — ${paystackState}`)

    return json({
      initiated:     true,
      needs_otp:     false,
      reference,
      transfer_code: transferCode,
      paystack_status: paystackState,
      message: 'Transfer sent. It will show as paid once Paystack confirms it.',
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('initiate-transfer failed:', message)
    // Only meaningful if the claim was made before the failure; harmless
    // otherwise, since it only touches a payout still in 'processing'.
    if (payoutId) await releaseClaim(payoutId, message)
    return json({ error: 'Could not initiate the transfer. The payout is still pending.' }, 500)
  }
})

async function releaseClaim(payoutId: string, reason: string) {
  const { error } = await supabase.rpc('release_payout_claim', {
    p_payout_id: payoutId,
    p_reason:    reason.slice(0, 300),
  })
  if (error) {
    // Worth shouting about: the payout is now stuck in 'processing' with no
    // transfer behind it, which freezes the creator's earnings until someone
    // resets it by hand.
    console.error(`FAILED TO RELEASE payout ${payoutId} — it is stuck in processing:`, error.message)
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
