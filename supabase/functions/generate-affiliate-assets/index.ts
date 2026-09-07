import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  // supabase-js attaches x-client-info and apikey on every invoke. Omitting
  // them fails the browser's preflight, which surfaces in the client as
  // "Failed to send a request to the Edge Function" rather than a CORS error.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Called when an admin approves a creator into a campaign.
//
// Deployed with --no-verify-jwt, because the platform's JWT gate also rejects
// the browser's CORS preflight. Authorisation is enforced here instead — and
// more tightly: the gate only proved the caller held *a* valid JWT, which any
// signed-in creator has, so it would have let them mint their own links.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

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

    // Role is read with the service-role client so RLS cannot hide it.
    const { data: callerProfile, error: roleError } = await supabase
      .from('profiles').select('role').eq('id', user.id).single()

    // A failed lookup is not the same as "not an admin". Both used to end
    // here as a 403, which told a real admin they lacked permission when the
    // truth was that the database could not be reached — sending them to
    // check their account instead of the outage.
    if (roleError) {
      console.error('role lookup failed for', user.id, roleError.message)
      return json({ error: 'Could not verify your permissions. Please try again.' }, 503)
    }

    if (callerProfile?.role !== 'admin') {
      return json({ error: 'Only COVO admins can generate affiliate links.' }, 403)
    }

    const { creator_id, campaign_id, product_ids } = await req.json()

    if (!creator_id || !campaign_id) {
      return json({ error: 'creator_id and campaign_id are required' }, 400)
    }

    const [{ data: campaign }, { data: creator }] = await Promise.all([
      supabase.from('campaigns').select('brand_id').eq('id', campaign_id).single(),
      supabase.from('profiles').select('full_name, email').eq('id', creator_id).single(),
    ])

    if (!campaign) return json({ error: 'Campaign not found' }, 404)
    if (!creator)  return json({ error: 'Creator not found' }, 404)

    // Brand identity comes from brand_profiles.company_name — profiles.full_name
    // is the person who signed up, which makes for a poor link ("acme-jane"
    // reads better than "john-smith-jane").
    const { data: brand } = await supabase
      .from('brand_profiles').select('company_name').eq('id', campaign.brand_id).single()

    const brandSlug     = slugify(brand?.company_name ?? 'brand')
    const creatorHandle = slugify(creator.full_name ?? creator.email?.split('@')[0] ?? 'creator')
    const discountCode  = `COVO-${brandSlug.toUpperCase()}-${creatorHandle.toUpperCase()}`

    // Fall back to every product on the campaign when none are specified.
    let productIds: string[] = product_ids ?? []
    if (!productIds.length) {
      // Archived products are retired, not deleted — their existing links
      // keep resolving, but minting new ones would point creators at
      // something the brand has stopped offering.
      const { data: products } = await supabase
        .from('products').select('id')
        .eq('campaign_id', campaign_id)
        .is('archived_at', null)
      productIds = (products ?? []).map(p => p.id)
    }

    if (!productIds.length) {
      return json({ error: 'This campaign has no products available to link to. Any it had have been archived.' }, 400)
    }

    const links = []
    for (const product_id of productIds) {
      // Slug must be unique across the whole table, so it always carries a
      // product discriminator — two campaigns from the same brand would
      // otherwise collide on "brand-creator".
      const slug = `${brandSlug}-${creatorHandle}-${product_id.slice(0, 6)}`

      const { data: link, error } = await supabase.from('affiliate_links').upsert({
        creator_id,
        campaign_id,
        product_id,
        slug,
        brand_slug:       brandSlug,
        creator_username: creatorHandle,
        discount_code:    discountCode,
      }, { onConflict: 'slug' }).select().single()

      if (error) return json({ error: error.message }, 500)
      links.push(link)
    }

    return json({ links, discount_code: discountCode })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}
