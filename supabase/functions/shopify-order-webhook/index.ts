import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Replaces record-conversion, which was called by a custom pixel in the
// shopper's browser and believed whatever order value it was handed. The
// covo_ref is public — it rides in the query string of every affiliate
// redirect — so anyone who had clicked a COVO link could POST fabricated
// orders at any amount and mint real commissions.
//
// Shopify signs every webhook with HMAC-SHA256 over the raw body. That
// signature is what now stands between a sale and a commission: the amount
// comes from Shopify, over a channel no shopper can reach.
//
// Deploy with --no-verify-jwt. Shopify does not send a Supabase JWT, and
// the platform gate would reject it before this code ran. Authorisation is
// the HMAC, which is strictly stronger than "held some valid JWT".
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Used when a shop has no row of its own — the single-app model, where one
// secret signs every store's webhooks.
const FALLBACK_SECRET = Deno.env.get('SHOPIFY_WEBHOOK_SECRET') ?? ''

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // The signature covers the bytes exactly as sent. Parsing first and
  // re-serialising would change key order and whitespace, and every
  // signature would fail — so the body is read as text and only parsed
  // once it has been verified.
  const raw       = await req.text()
  const signature = req.headers.get('x-shopify-hmac-sha256') ?? ''
  const domain    = (req.headers.get('x-shopify-shop-domain') ?? '').toLowerCase()
  const topic     = req.headers.get('x-shopify-topic') ?? ''

  if (!signature || !domain) return new Response('Missing Shopify headers', { status: 400 })

  // The domain header is untrusted at this point; it only selects which
  // secret to try. A forged domain simply fails the comparison below.
  const { data: shop } = await supabase
    .from('shopify_shops')
    .select('brand_id, shop_domain, active')
    .eq('shop_domain', domain)
    .maybeSingle()

  if (shop && shop.active === false) {
    // Acknowledged, not acted on: a 4xx would make Shopify retry for days.
    return json({ ignored: 'Store is not active on COVO' })
  }

  const secret = shop
    ? await shopSecret(domain)
    : FALLBACK_SECRET

  if (!secret) {
    console.error('no webhook secret for shop:', domain)
    return new Response('Unknown shop', { status: 401 })
  }

  if (!(await verify(raw, signature, secret))) {
    console.error('HMAC mismatch for shop:', domain)
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response('Malformed body', { status: 400 })
  }

  const brandId = shop?.brand_id ?? null

  try {
    switch (topic) {
      case 'orders/create':
      case 'orders/paid':
        return await onOrder(payload, domain, brandId)

      case 'refunds/create':
        return await onRefund(payload, brandId)

      case 'orders/cancelled':
        return await onCancel(payload, brandId)

      default:
        return json({ ignored: `Unhandled topic ${topic}` })
    }
  } catch (e) {
    console.error(topic, e)
    // 500 so Shopify retries — a transient database error must not silently
    // cost a creator their commission.
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})

// ── Handlers ───────────────────────────────────────────────────────────

async function onOrder(order: any, domain: string, brandId: string | null) {
  const ref = extractRef(order)
  if (!ref) return json({ recorded: false, reason: 'No covo_ref on this order' })

  // Subtotal, not total: total includes shipping and VAT, and paying
  // commission on those means the brand pays the creator for courier costs
  // and money owed to SARS. current_* reflects edits made after placement.
  const amount = num(order.current_subtotal_price) ?? num(order.subtotal_price)
  if (amount === null) return json({ recorded: false, reason: 'No subtotal on this order' })

  const currency = String(order.currency ?? order.presentment_currency ?? 'ZAR')

  const { data, error } = await supabase.rpc('record_shopify_conversion', {
    p_link_id:     ref,
    p_order_id:    String(order.id),
    p_sale_amount: amount,
    p_currency:    currency,
    p_shop_domain: domain,
    p_brand_id:    brandId,
  })

  if (error) throw new Error(error.message)

  const result = Array.isArray(data) ? data[0] : data
  return json(result ?? { recorded: false, reason: 'No result' })
}

async function onRefund(refund: any, brandId: string | null) {
  if (!brandId) return json({ applied: false, reason: 'Unregistered shop' })

  // Sum the goods value coming back, to match how the commission was
  // calculated. Shipping refunds do not reduce a commission that was never
  // charged on shipping.
  const lines = Array.isArray(refund.refund_line_items) ? refund.refund_line_items : []
  let refunded = 0
  for (const line of lines) {
    refunded += num(line?.subtotal_set?.shop_money?.amount) ?? num(line?.subtotal) ?? 0
  }

  if (refunded <= 0) return json({ applied: false, reason: 'No goods value refunded' })

  const { data, error } = await supabase.rpc('apply_shopify_refund', {
    p_brand_id:        brandId,
    p_order_id:        String(refund.order_id),
    p_refunded_amount: refunded,
  })

  if (error) throw new Error(error.message)

  const result = Array.isArray(data) ? data[0] : data
  return json(result ?? { applied: false, reason: 'No result' })
}

async function onCancel(order: any, brandId: string | null) {
  if (!brandId) return json({ applied: false, reason: 'Unregistered shop' })

  // A cancellation takes the whole order back, so refund its full subtotal.
  const amount = num(order.current_subtotal_price) ?? num(order.subtotal_price)
  if (amount === null || amount <= 0) return json({ applied: false, reason: 'Nothing to reverse' })

  const { data, error } = await supabase.rpc('apply_shopify_refund', {
    p_brand_id:        brandId,
    p_order_id:        String(order.id),
    p_refunded_amount: amount,
  })

  if (error) throw new Error(error.message)

  const result = Array.isArray(data) ? data[0] : data
  return json(result ?? { applied: false, reason: 'No result' })
}

// ── Attribution ────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// theme.liquid writes covo_ref onto the cart, and Shopify carries cart
// attributes onto the order as note_attributes. landing_site is the
// fallback for a shopper who bought in one session without the cart
// attribute ever being set.
function extractRef(order: any): string | null {
  const attrs = Array.isArray(order?.note_attributes) ? order.note_attributes : []
  for (const a of attrs) {
    if (a?.name === 'covo_ref' && typeof a.value === 'string' && UUID_RE.test(a.value.trim())) {
      return a.value.trim()
    }
  }

  const landing = typeof order?.landing_site === 'string' ? order.landing_site : ''
  if (landing.includes('covo_ref')) {
    // landing_site is a path with a query string, not an absolute URL.
    const query = landing.split('?')[1] ?? ''
    const fromUrl = new URLSearchParams(query).get('covo_ref')?.trim()
    if (fromUrl && UUID_RE.test(fromUrl)) return fromUrl
  }

  return null
}

// ── Crypto ─────────────────────────────────────────────────────────────

async function shopSecret(domain: string): Promise<string> {
  // Fetched in its own query so the secret never travels with the row that
  // gets logged or returned anywhere.
  const { data } = await supabase
    .from('shopify_shops')
    .select('webhook_secret')
    .eq('shop_domain', domain)
    .maybeSingle()
  return data?.webhook_secret ?? FALLBACK_SECRET
}

async function verify(body: string, signature: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)))
  return timingSafeEqual(expected, signature)
}

// Compared in constant time. A plain === leaks how many leading characters
// matched through its timing, which is enough to forge a signature one
// character at a time given enough attempts.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ── Helpers ────────────────────────────────────────────────────────────

// Shopify sends money as decimal strings ("249.00"), not numbers.
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
