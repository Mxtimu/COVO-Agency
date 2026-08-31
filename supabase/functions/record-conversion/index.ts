import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// RETIRED — replaced by shopify-order-webhook.
//
// This endpoint accepted a sale amount from the shopper's browser. It ran
// as a Shopify custom pixel on the brand's domain, where there is no COVO
// session to authenticate, so it was public by necessity and its safety
// argument rested on needing "a real affiliate link and a real order id".
// Neither held: the link id is the covo_ref that appears in the query
// string of every affiliate redirect, and the order id was whatever the
// caller sent. The unique constraint stopped replays, not invention.
// Anyone who had ever clicked a COVO link could post fabricated orders at
// any value and mint commissions that would confirm and become payable.
//
// Conversions now arrive from Shopify's HMAC-signed orders/create webhook,
// so the amount comes from Shopify rather than from the buyer's browser.
//
// The body is deliberately kept rather than deleted: deleting the source
// would leave the old function still deployed and still accepting writes.
// Redeploy this to close it, then remove it once no storefront calls it:
//
//   supabase functions deploy record-conversion
//   supabase functions delete record-conversion
//
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  console.warn('record-conversion called after retirement from', req.headers.get('origin') ?? 'unknown origin')

  return new Response(
    JSON.stringify({
      error: 'This endpoint has been retired. Conversions are recorded from Shopify order webhooks — see shopify/README.md.',
    }),
    { status: 410, headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
