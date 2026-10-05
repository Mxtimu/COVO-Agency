// Drains public.email_outbox through Resend's HTTP API.
//
// Resend over SMTP is what Supabase Auth uses for confirmation mail. This
// uses the HTTP API instead, because an Edge Function has no SMTP client
// and fetch is the only way out of the isolate.
//
// Invoked by cron. It claims rows before sending — claim_emails_to_send
// flips them to 'sending' in the same statement that returns them — so
// two overlapping runs cannot send the same message twice.
//
// Deploy with --no-verify-jwt and keep CRON_SECRET set: the platform's
// JWT gate accepts the anon key, which every browser has, so the real
// authorisation is the shared secret checked below.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY   = Deno.env.get('RESEND_API_KEY')
const CRON_SECRET  = Deno.env.get('CRON_SECRET')
const FROM         = Deno.env.get('EMAIL_FROM') ?? 'COVO <onboarding@resend.dev>'

// How many to send per invocation. Resend's free tier allows 2 requests
// per second, and the loop below paces itself to stay under that, so a
// larger batch would mostly be spent sleeping inside one isolate.
const BATCH = 20

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // A missing CRON_SECRET must fail closed. Treating "unset" as "open"
  // would leave a function that sends mail callable by anyone holding
  // the anon key, which is published in the frontend bundle.
  if (!CRON_SECRET) {
    console.error('[email-outbox] CRON_SECRET is not set; refusing to run')
    return json({ error: 'Not configured' }, 500)
  }

  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, 401)
  }

  if (!RESEND_KEY) {
    console.error('[email-outbox] RESEND_API_KEY is not set; nothing claimed')
    return json({ error: 'Email is not configured' }, 500)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  const { data: queued, error } = await supabase
    .rpc('claim_emails_to_send', { p_limit: BATCH })

  if (error) {
    console.error('[email-outbox] could not claim', error)
    return json({ error: 'Could not claim queued email' }, 500)
  }

  if (!queued?.length) {
    return json({ sent: 0, failed: 0, note: 'nothing queued' })
  }

  let sent = 0
  let failed = 0

  for (const msg of queued) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM,
          to: [msg.recipient],
          subject: msg.subject,
          text: msg.body_text,
          ...(msg.body_html ? { html: msg.body_html } : {}),
        }),
      })

      const body = await res.json().catch(() => ({}))

      if (res.ok && body?.id) {
        await supabase.rpc('mark_email_sent', {
          p_id: msg.id,
          p_provider_id: body.id,
        })
        sent++
      } else {
        // The message Resend gives here is the diagnosis, so it is
        // stored rather than flattened to "send failed". On the free
        // tier, mail to anyone but the account address comes back as a
        // 403 about the domain not being verified — which is a Resend
        // setting, not a bug, and the text is what makes that obvious
        // when someone looks at the table later.
        const detail = body?.message ?? body?.error ?? `HTTP ${res.status}`
        console.error('[email-outbox] send rejected', msg.kind, detail)
        await supabase.rpc('mark_email_failed', {
          p_id: msg.id,
          p_error: String(detail).slice(0, 500),
        })
        failed++
      }
    } catch (err) {
      // A thrown fetch leaves the row 'sending'. mark_email_failed puts
      // it back in the queue; without this it would sit claimed until
      // the 15-minute reclaim in claim_emails_to_send picked it up.
      console.error('[email-outbox] send threw', msg.kind, err)
      await supabase.rpc('mark_email_failed', {
        p_id: msg.id,
        p_error: String(err instanceof Error ? err.message : err).slice(0, 500),
      })
      failed++
    }

    // Stay under Resend's 2 requests/second.
    await new Promise((r) => setTimeout(r, 550))
  }

  return json({ sent, failed, claimed: queued.length })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
