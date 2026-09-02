import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

serve(async (req) => {
  const url = new URL(req.url)
  // /affiliate-redirect?code=brand-creator  or  /affiliate-redirect/brand-creator
  const code = url.searchParams.get('code') ?? url.pathname.split('/').pop()

  if (!code || code === 'affiliate-redirect') {
    return new Response('Not found', { status: 404 })
  }

  // Every link was reporting roughly double its real traffic, because this
  // function had no method guard and logged a click for anything that
  // reached it. A creator's link is shared into WhatsApp, Slack or iMessage
  // long before a human taps it, and every one of those fetches a preview:
  // a HEAD, then later the real GET, is two rows for one visitor. Chrome
  // does the same thing by prefetching a URL it predicts you will open.
  //
  // These requests still get a correct redirect — a preview that 405s looks
  // broken to the person about to share the link. They simply are not
  // counted as visits.
  const isRealVisit = req.method === 'GET' && !isPrefetchOrBot(req)

  // The destination lives on the product, not the link — so a brand changing
  // a product URL updates every creator's link at once.
  const { data: link, error } = await supabase
    .from('affiliate_links')
    .select('id, creator_id, campaign_id, product_id, products(tracking_url)')
    .eq('slug', code)
    .single()

  if (error || !link) {
    return new Response('Link not found', { status: 404 })
  }

  // PostgREST returns an embedded 1-to-1 as either an object or a single-element array.
  const product = Array.isArray(link.products) ? link.products[0] : link.products
  const dest    = product?.tracking_url

  // An archived product still redirects — retiring one is not meant to
  // break the links creators have already shared. A NULL product_id is a
  // different thing entirely: the product was hard-deleted, which set the
  // reference to NULL and orphaned this link permanently. That is no longer
  // possible for a product with links, but links orphaned before
  // guard_product_delete() existed are still out there being shared.
  if (!link.product_id) {
    console.error('orphaned link — product was deleted:', link.id)
    return new Response('This product is no longer available', { status: 404 })
  }

  if (!dest) {
    return new Response('This link is not ready yet', { status: 404 })
  }

  // tracking_url is typed in by a brand, and this function will send anyone
  // who clicks a creator's link wherever it points. The storefront form
  // normalises what it accepts, but the column is reachable from any brand's
  // session, so the scheme is checked here too — at the point of use, where
  // it actually matters. javascript: and data: URLs are the ones worth
  // caring about; a brand that could store one would have every creator on
  // its campaign handing their audience a hostile link under COVO's name.
  let target: URL
  try {
    target = new URL(dest)
  } catch {
    console.error('unparseable tracking_url on link', link.id)
    return new Response('This link is not ready yet', { status: 404 })
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    console.error('rejected non-http tracking_url on link', link.id, target.protocol)
    return new Response('This link is not ready yet', { status: 404 })
  }

  // Awaited deliberately. Edge runtimes tear down the isolate as soon as the
  // response is returned, so a fire-and-forget insert loses clicks silently
  // and intermittently — the attribution data has to be worth trusting.
  //
  // record_click() does the duplicate check and the insert in one statement.
  // Doing it as a SELECT then an INSERT from here would not help: a prefetch
  // and the real navigation arrive milliseconds apart, so both would find
  // nothing and both would insert.
  if (isRealVisit) {
    const { error: clickError } = await supabase.rpc('record_click', {
      p_link_id:     link.id,
      p_creator_id:  link.creator_id,
      p_campaign_id: link.campaign_id,
      p_product_id:  link.product_id,
      p_ip_hash:     await hashIP(req.headers.get('x-forwarded-for') ?? ''),
      p_user_agent:  req.headers.get('user-agent') ?? '',
      p_referrer:    req.headers.get('referer')    ?? '',
    })

    // A logging failure must never cost the brand a sale — redirect regardless.
    if (clickError) console.error('record_click failed:', clickError.message)
  }

  // Attribution rides in the URL, not a cookie. The cookie set here belongs to
  // this function's domain, and the brand's Shopify store runs on its own
  // domain — it could never read it. The storefront snippet picks covo_ref off
  // the landing URL and persists it in the shop's own first-party storage.
  target.searchParams.set('covo_ref', link.id)

  return new Response(null, {
    status: 302,
    headers: {
      'Location':      target.toString(),
      'Cache-Control': 'no-store',
    },
  })
})

// A request that is not a person arriving at the link.
//
// The Sec-Purpose / Purpose / X-Purpose headers are how browsers announce a
// speculative fetch — Chrome sends "prefetch" for a URL it predicts you will
// open, then requests it again for real when you do. The bot pattern catches
// the crawlers that fetch a link the moment it is posted anywhere.
function isPrefetchOrBot(req: Request): boolean {
  const h = (name: string) => (req.headers.get(name) ?? '').toLowerCase()

  const purpose = `${h('sec-purpose')} ${h('purpose')} ${h('x-purpose')} ${h('x-moz')}`
  if (/prefetch|preview|prerender|prefetch;prerender/.test(purpose)) return true

  const ua = h('user-agent')
  if (!ua) return true   // no user agent at all is not a browser

  return /bot|crawler|spider|slurp|facebookexternalhit|whatsapp|telegram|slackbot|discordbot|twitterbot|linkedinbot|embedly|quora link preview|pinterest|redditbot|applebot|bingpreview|skypeuripreview|vkshare|preview|scrapy|curl|wget|python-requests|headless/.test(ua)
}

// x-forwarded-for is a proxy chain — "client, proxy1, proxy2" — and the tail
// can differ between two requests from the same visitor. Hashing the whole
// header would therefore produce different keys for the prefetch and the real
// navigation, and the deduplication would never match. Only the leftmost
// entry, the original client, is stable.
async function hashIP(forwardedFor: string): Promise<string> {
  const client = forwardedFor.split(',')[0].trim()
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(client))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
