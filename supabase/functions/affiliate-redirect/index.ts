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
  const { error: clickError } = await supabase.from('clicks').insert({
    affiliate_link_id: link.id,
    creator_id:        link.creator_id,
    campaign_id:       link.campaign_id,
    product_id:        link.product_id,
    ip_hash:           await hashIP(req.headers.get('x-forwarded-for') ?? ''),
    user_agent:        req.headers.get('user-agent') ?? '',
    referrer:          req.headers.get('referer')    ?? '',
  })

  // A logging failure must never cost the brand a sale — redirect regardless.
  if (clickError) console.error('click insert failed:', clickError.message)

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

async function hashIP(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
