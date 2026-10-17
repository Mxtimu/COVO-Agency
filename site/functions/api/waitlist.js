// Cloudflare Pages Function — POST /api/waitlist
//
// The page posts here instead of talking to Supabase directly. The anon key
// is publishable by design and RLS is what actually protects the data, so a
// direct insert from the browser would also have been safe — but this site
// has no build step, which means anything the browser needs would have to be
// committed to the repo in plain text. Keeping the key in a Cloudflare
// environment variable avoids that, and buys three things besides:
//
//   - same origin, so no CORS preflight on every signup
//   - server-side validation and a honeypot, which a static page cannot do
//   - one place to change if the waitlist ever moves off Supabase
//
// Set in Cloudflare → Pages → Settings → Environment variables:
//   SUPABASE_URL       https://<project-ref>.supabase.co
//   SUPABASE_ANON_KEY  the project's anon/publishable key
//
// Never put the service_role key here. The anon key can insert a waitlist row
// and nothing else — public.waitlist grants INSERT to anon and deliberately
// grants no SELECT, so this endpoint cannot read the list back even if
// someone found a way to make it try.

export async function onRequestPost(context) {
  const { request, env } = context

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    console.error('[waitlist] SUPABASE_URL or SUPABASE_ANON_KEY is not set')
    return json({ error: 'The waitlist is temporarily unavailable. Please try again shortly.' }, 503)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }

  // Honeypot: a field hidden from people and irresistible to bots. Answer 200
  // so the bot believes it worked and does not come back to retry.
  if (typeof body?.company === 'string' && body.company.trim() !== '') {
    return json({ ok: true })
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

  // Deliberately loose. Email validation by regex is a famous way to reject
  // real addresses; the only thing worth refusing here is something that
  // obviously is not one. Delivery is the real test.
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400)
  }

  const role = body?.role === 'brand' || body?.role === 'creator' ? body.role : null

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/waitlist`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      email,
      // Which site and which button, so the list can be segmented later
      // without having to guess where someone came from.
      source: role ? `site:${role}` : 'site',
      user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
    }),
  })

  if (res.ok) return json({ ok: true })

  const detail = await res.text().catch(() => '')

  // 23505 is the unique index on LOWER(email): they are already on the list.
  // Nothing has gone wrong from their side, so it is a success, not an error —
  // and saying "you are already on the list" to someone who signed up twice is
  // friendlier than an error they cannot act on.
  if (res.status === 409 || detail.includes('23505')) {
    return json({ ok: true, already: true })
  }

  console.error('[waitlist] supabase rejected the insert', res.status, detail.slice(0, 300))
  return json({ error: 'Something went wrong on our side. Please try again shortly.' }, 502)
}

// Anything but POST. Without this a GET to /api/waitlist falls through to the
// static asset handler and returns the 404 page, which reads as a broken site.
export async function onRequest() {
  return json({ error: 'Method not allowed' }, 405)
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}
