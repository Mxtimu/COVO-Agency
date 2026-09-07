import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createHmac }   from 'https://deno.land/std@0.168.0/node/crypto.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)
const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') ?? ''

// Every money operation here used to be a separate unchecked round trip,
// followed by an unconditional 200. That combination is the worst possible
// one: a step could fail, nothing recorded it, and the 200 told Paystack the
// event was handled so it never retried.
//
// The sequences now live in single database functions — apply_paystack_deposit
// and mark_payout_settled — so each is one transaction that either completes
// or rolls back entirely. This file's remaining job is to report failure
// honestly. A 500 is not an error to be avoided here; it is how Paystack is
// told to deliver the event again.
serve(async (req) => {
  // Without the secret there is no way to tell a real Paystack delivery from
  // anything else, so nothing here may run. This used to be a bare `!`
  // assertion, which meant createHmac threw on an undefined key and every
  // request — signed or not — died as an unhandled 500 before the signature
  // was ever compared. A 500 is also the one answer that makes Paystack keep
  // retrying, so a missing secret would have produced endless redeliveries of
  // events that could never be processed.
  if (!PAYSTACK_SECRET) {
    console.error('PAYSTACK_SECRET_KEY is not set — refusing to process webhooks. ' +
                  'Set it with: npx supabase secrets set PAYSTACK_SECRET_KEY=sk_...')
    return new Response('Webhook not configured', { status: 503 })
  }

  // ── 1. Verify Paystack HMAC signature ─────────────────────────────
  const body      = await req.text()
  const signature = req.headers.get('x-paystack-signature') ?? ''
  const expected  = createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex')
  if (signature !== expected) {
    return new Response('Unauthorized', { status: 401 })
  }

  let event: { event?: string; data?: Record<string, unknown> }
  try {
    event = JSON.parse(body)
  } catch {
    // Unparseable will never parse — 400 so Paystack stops rather than
    // retrying the same broken payload for days.
    return new Response('Malformed body', { status: 400 })
  }

  const ref = typeof event.data?.reference === 'string' ? event.data.reference : ''

  try {
    switch (event.event) {
      // ── Brand escrow deposit ──────────────────────────────────────
      case 'charge.success': {
        if (!ref) return bad('charge.success with no reference')

        const rawAmount = Number(event.data?.amount)
        if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
          return bad(`charge.success ${ref} with unusable amount ${event.data?.amount}`)
        }
        const amount = rawAmount / 100  // Paystack sends in kobo/cents

        const { data, error } = await supabase.rpc('apply_paystack_deposit', {
          p_reference: ref,
          p_amount:    amount,
        })

        // The deposit is the one place a silent failure costs a brand real
        // money, so this throws rather than logging and moving on.
        if (error) throw new Error(`apply_paystack_deposit(${ref}): ${error.message}`)

        const result = Array.isArray(data) ? data[0] : data

        if (!result?.deposit_applied) {
          // Already applied, or an unknown reference. Both are settled
          // states, not failures — acknowledge so Paystack stops.
          console.log(`deposit ${ref} not applied: ${result?.outcome ?? 'no result'}`)
          return ok()
        }

        console.log(
          `deposit ${ref}: R${amount} credited, balance now R${result.escrow_after}, ` +
          `${result.released} held commission(s) released` +
          (result.campaign_resumed ? ', campaign resumed' : ''),
        )
        return ok()
      }

      // ── Creator payout settled ────────────────────────────────────
      case 'transfer.success':
      case 'transfer.failed':
      case 'transfer.reversed': {
        if (!ref) return bad(`${event.event} with no reference`)

        const status = event.event === 'transfer.success'  ? 'success'
                     : event.event === 'transfer.reversed' ? 'reversed'
                     : 'failed'

        const { data, error } = await supabase.rpc('mark_payout_settled', {
          p_reference: ref,
          p_status:    status,
        })

        if (error) throw new Error(`mark_payout_settled(${ref}, ${status}): ${error.message}`)

        const result = Array.isArray(data) ? data[0] : data

        if (!result?.payout_updated) {
          console.log(`payout ${ref} unchanged: ${result?.outcome ?? 'no result'}`)
          return ok()
        }

        console.log(`payout ${ref} -> ${status}, ${result.commissions_changed} commission(s) updated`)
        return ok()
      }

      default:
        // Paystack sends events COVO does not act on. Acknowledge them —
        // a non-200 would have it retry something we will never handle.
        return ok()
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`paystack ${event.event} ${ref} FAILED:`, message)
    // 500 so Paystack redelivers. The database function rolled its whole
    // transaction back, so the retry starts from a clean state.
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

function ok() {
  return new Response('OK', { status: 200 })
}

// A 400 for something that will never succeed on retry, logged loudly so it
// is visible in Paystack's delivery log rather than only here.
function bad(reason: string) {
  console.error('paystack rejected:', reason)
  return new Response(reason, { status: 400 })
}
