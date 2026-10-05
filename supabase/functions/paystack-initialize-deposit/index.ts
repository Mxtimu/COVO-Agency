import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// A brand funding one of its campaigns.
//
// This is the half of money-in that never existed. The deposit path was
// proven end to end, but the only tranche that had ever been written was one
// inserted by hand for testing — there was no way for a brand to create one,
// so "Add funds" sat disabled and a brand signing up could not put money in.
//
// The order matters: the Paystack transaction is initialised FIRST, and the
// pending tranche is written against the reference it returns. Doing it the
// other way would leave an orphan tranche whenever Paystack refused, and
// those accumulate as phantom pending deposits that never resolve.
//
// The amount a brand types is not trusted as the amount deposited. It decides
// what Paystack asks them to pay; the webhook credits whatever Paystack says
// was actually received. A brand editing the number in the browser only
// changes what it is about to be charged.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') ?? ''

// ZAR. Four times the R500 escrow floor, on purpose: a campaign funded to
// exactly the floor pauses again on its first commission, so the smallest
// useful deposit is well above the smallest permitted balance.
const MIN_DEPOSIT = 2000
const MAX_DEPOSIT = 500000   // ZAR — a typo guard, not a business limit

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (!PAYSTACK_SECRET) {
    console.error('PAYSTACK_SECRET_KEY is not set')
    return json({ error: 'Payments are not configured yet.' }, 503)
  }

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

    const body       = await req.json()
    const campaignId = String(body.campaign_id ?? '').trim()
    const rawAmount  = Number(body.amount)

    if (!campaignId) return json({ error: 'Choose a campaign to fund.' }, 400)

    if (!Number.isFinite(rawAmount) || rawAmount < MIN_DEPOSIT) {
      return json({ error: `The smallest deposit is R${MIN_DEPOSIT.toLocaleString('en-ZA')}. A campaign pauses below R500, so a smaller top-up would not keep it running for long.` }, 400)
    }
    if (rawAmount > MAX_DEPOSIT) {
      return json({ error: `That is over R${MAX_DEPOSIT.toLocaleString('en-ZA')}. Contact COVO to fund more in one go.` }, 400)
    }

    const amount = Math.round(rawAmount * 100) / 100

    // ── The campaign must be theirs, and it must have an escrow account ──
    // Read with the service role so the answer does not depend on RLS, then
    // check ownership explicitly.
    const { data: escrow, error: escrowError } = await supabase
      .from('campaign_escrow')
      .select('id, brand_id, campaign_id, balance, campaigns(title)')
      .eq('campaign_id', campaignId)
      .maybeSingle()

    if (escrowError) throw new Error(`escrow lookup: ${escrowError.message}`)

    if (!escrow) {
      return json({
        error: 'This campaign has no escrow account yet. COVO creates one when the campaign is approved.',
      }, 409)
    }

    if (escrow.brand_id !== user.id) {
      // Deliberately the same wording as a missing campaign: a brand probing
      // ids should not learn which ones exist.
      return json({ error: 'This campaign has no escrow account yet.' }, 409)
    }

    const campaign = Array.isArray(escrow.campaigns) ? escrow.campaigns[0] : escrow.campaigns

    const { data: profile } = await supabase
      .from('profiles').select('email').eq('id', user.id).single()

    if (!profile?.email) {
      return json({ error: 'Your account has no email address, which Paystack requires.' }, 409)
    }

    // ── Paystack first, tranche second ──────────────────────────────
    const reference = `COVO-DEP-${campaignId.slice(0, 8)}-${Date.now()}`

    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        email:    profile.email,
        amount:   Math.round(amount * 100),   // cents
        currency: 'ZAR',
        reference,
        metadata: {
          campaign_id:    campaignId,
          campaign_title: campaign?.title ?? '',
          brand_id:       user.id,
          purpose:        'covo_campaign_escrow',
        },
      }),
    })

    const payload = await res.json().catch(() => ({}))

    if (!res.ok || !payload?.status || !payload.data?.authorization_url) {
      const message = payload?.message ?? `Paystack refused the request (${res.status})`
      console.error('initialize refused:', message)
      return json({ error: message }, 400)
    }

    // Now that Paystack has a transaction under this reference, record the
    // deposit we are expecting. paystack_status stays 'pending' until the
    // signed webhook claims it — nothing here credits any balance.
    const { error: trancheError } = await supabase.from('escrow_tranches').insert({
      escrow_id:          escrow.id,
      campaign_id:        escrow.campaign_id,
      brand_id:           escrow.brand_id,
      amount,
      paystack_reference: reference,
      paystack_status:    'pending',
    })

    if (trancheError) {
      // The Paystack transaction exists but we have nothing to claim it
      // with, so paying it would credit nobody. Better to fail here, while
      // the brand has not been charged, than to send them to a checkout
      // whose payment we could never apply.
      console.error(`tranche insert failed for ${reference}:`, trancheError.message)
      return json({ error: 'Could not start the deposit. Please try again.' }, 500)
    }

    console.log(`deposit ${reference}: R${amount} staged for "${campaign?.title}"`)

    return json({
      // access_code drives Paystack's inline modal, which keeps the brand on
      // the page. authorization_url is the same transaction as a hosted page,
      // kept as the fallback for when the modal script cannot load.
      access_code:       payload.data.access_code,
      authorization_url: payload.data.authorization_url,
      reference,
      amount,
      campaign_title: campaign?.title ?? '',
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('initialize-deposit failed:', message)
    return json({ error: 'Could not start the deposit. Please try again.' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
