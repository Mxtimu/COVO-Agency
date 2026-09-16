import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// A creator registering the account they want to be paid into.
//
// Paystack pays a *recipient*, not an account number: the bank details are
// exchanged once for a recipient_code, and every transfer afterwards
// references that code. So the account number passes through this function
// and is never stored — only the code, and the last four digits so the
// creator can recognise which account they registered.
//
// Deployed with --no-verify-jwt: the platform gate would reject the browser's
// CORS preflight. Authorisation is the creator's own JWT, checked below, and
// a creator may only ever register their own account.
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

    const body = await req.json()
    const bankCode      = String(body.bank_code ?? '').trim()
    const accountNumber = String(body.account_number ?? '').replace(/\s/g, '')
    const accountName   = String(body.account_name ?? '').trim()

    if (!bankCode)      return json({ error: 'Please choose your bank.' }, 400)
    if (!accountName)   return json({ error: 'Please enter the account holder name.' }, 400)
    if (!/^\d{6,14}$/.test(accountNumber)) {
      return json({ error: 'That does not look like a valid account number.' }, 400)
    }

    // type 'basa' is Paystack's South African bank recipient. The account
    // number is in this request body and in Paystack's records — it is
    // deliberately not written to the response, the logs, or the database.
    const res = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        type:           'basa',
        name:           accountName,
        account_number: accountNumber,
        bank_code:      bankCode,
        currency:       'ZAR',
      }),
    })

    const payload = await res.json().catch(() => ({}))

    if (!res.ok || !payload?.status) {
      // Paystack's message is the useful one here — it says things like
      // "Account number is invalid" that the creator can actually act on.
      const message = payload?.message ?? 'Could not verify those bank details.'
      console.error('recipient creation refused:', res.status, message)
      return json({ error: message }, 400)
    }

    const recipientCode = payload.data?.recipient_code
    const resolvedName  = payload.data?.details?.account_name || accountName
    const resolvedBank  = payload.data?.details?.bank_name    || ''

    if (!recipientCode) {
      console.error('Paystack returned no recipient_code:', JSON.stringify(payload).slice(0, 300))
      return json({ error: 'Paystack did not return a recipient. Please try again.' }, 502)
    }

    const { data, error } = await supabase.rpc('set_payout_recipient', {
      p_creator:        user.id,
      p_recipient_code: recipientCode,
      p_bank_code:      bankCode,
      p_bank_name:      resolvedBank,
      p_account_name:   resolvedName,
      p_last4:          accountNumber.slice(-4),
    })

    if (error) throw new Error(`set_payout_recipient: ${error.message}`)

    const result = Array.isArray(data) ? data[0] : data
    if (!result?.updated) {
      return json({ error: result?.outcome ?? 'Could not save your payout details.' }, 400)
    }

    // Deliberately returns only what is safe to show back.
    return json({
      saved:         true,
      bank_name:     resolvedBank,
      account_name:  resolvedName,
      account_last4: accountNumber.slice(-4),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('create-recipient failed:', message)
    return json({ error: 'Something went wrong saving your payout details.' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
