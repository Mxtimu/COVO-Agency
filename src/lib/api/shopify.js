import { supabase } from '../supabase'

// Brand-side Shopify connection.
//
// Every call goes through a SECURITY DEFINER function rather than touching
// shopify_shops directly. That table has RLS on with no policies at all,
// which is deliberate: it holds webhook signing secrets, and a secret that
// can be read back is a secret anyone with a session can use to forge that
// store's orders. The functions let a brand set it and replace it, never
// read it.

// The endpoint the brand pastes into Shopify. Built from the same env var
// the client uses, so a project change cannot leave this pointing at the
// wrong backend.
export const WEBHOOK_URL =
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/shopify-order-webhook`

// The four events COVO needs, in the words Shopify's own UI uses — so the
// brand is matching labels, not translating.
export const WEBHOOK_EVENTS = [
  { topic: 'Order creation',     why: 'records the sale and works out the commission' },
  { topic: 'Order payment',      why: 'confirms the order was actually paid for' },
  { topic: 'Order cancellation', why: 'reverses the commission in full' },
  { topic: 'Refund create',      why: 'reduces the commission by what was refunded' },
]

// Persists the ref across a shopper browsing the store. Without it only
// same-session purchases are attributed — Shopify records the landing URL
// on the order, so the ref still survives a direct buy.
export function themeSnippet() {
  return `<script>
(function () {
  var DAYS = 30;
  function ref() {
    try {
      var u = new URLSearchParams(window.location.search).get('covo_ref');
      if (u) {
        localStorage.setItem('covo_ref', u);
        localStorage.setItem('covo_ref_at', Date.now());
        return u;
      }
      var s = localStorage.getItem('covo_ref');
      var t = Number(localStorage.getItem('covo_ref_at') || 0);
      if (s && t && Date.now() - t > DAYS * 86400000) {
        localStorage.removeItem('covo_ref');
        localStorage.removeItem('covo_ref_at');
        return null;
      }
      return s;
    } catch (e) { return null; }
  }
  var r = ref();
  if (!r) return;
  fetch('/cart/update.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attributes: { covo_ref: r } })
  }).catch(function () {});
})();
</script>`
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data
}

export async function fetchShopifyStatus() {
  const { data, error } = await supabase.rpc('brand_shopify_status')
  if (error) return { status: null, error }

  const r = firstRow(data)
  if (!r) return { status: { state: 'none' }, error: null }

  return {
    status: {
      domain:      r.out_domain,
      state:       r.out_state,          // none | pending | verified | disabled
      connectedAt: r.out_connected,
      verifiedAt:  r.out_verified,
      lastHookAt:  r.out_last_hook,
      orders:      r.out_orders ?? 0,
      explanation: r.out_explanation,
    },
    error: null,
  }
}

export async function connectShopify({ domain, secret }) {
  const { data, error } = await supabase.rpc('brand_connect_shopify', {
    p_shop_domain:    domain,
    p_webhook_secret: secret,
  })

  // A thrown error here is a privilege or network failure. The function's
  // own refusals (a domain that belongs to someone else, a malformed
  // domain) come back as a row with out_connected false and a sentence in
  // out_outcome — those are expected answers, not faults, and the message
  // is written to be shown as-is.
  if (error) return { connected: false, outcome: error.message, error }

  const r = firstRow(data)
  return {
    connected: !!r?.out_connected,
    state:     r?.out_state ?? null,
    domain:    r?.out_domain ?? null,
    outcome:   r?.out_outcome ?? null,
    error:     null,
  }
}

export async function disconnectShopify() {
  const { data, error } = await supabase.rpc('brand_disconnect_shopify')
  if (error) return { disconnected: false, outcome: error.message, error }
  const r = firstRow(data)
  return {
    disconnected: !!r?.out_disconnected,
    outcome:      r?.out_outcome ?? null,
    error:        null,
  }
}
