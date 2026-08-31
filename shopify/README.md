# COVO — Shopify integration

One snippet in the theme, one webhook in Shopify's admin.

The snippet's only job is to remember **which creator** sent the shopper. It
never reports the sale — Shopify does that itself, over a signed webhook. That
split is deliberate: a value the browser can set is a value a shopper can
forge, and the sale amount decides what COVO pays out.

Replace `PROJECT_REF` with the COVO Supabase project ref
(`nyeulzucksldwlcrbbmo`).

---

## 1. Capture — `theme.liquid`

Shoppers arriving from a creator's link land with `?covo_ref=...` on the URL.
That parameter disappears as soon as they browse to another page, so it is
persisted immediately and then written onto the cart, which is what carries it
through to the order.

**Where:** Online Store → Themes → Edit code → `layout/theme.liquid`, just
before `</head>`.

```html
<script>
(function () {
  var ATTRIBUTION_DAYS = 30;

  function readRef() {
    try {
      var fromUrl = new URLSearchParams(window.location.search).get('covo_ref');
      if (fromUrl) {
        localStorage.setItem('covo_ref', fromUrl);
        localStorage.setItem('covo_ref_at', Date.now());
        return fromUrl;
      }
      var stored = localStorage.getItem('covo_ref');
      var setAt  = Number(localStorage.getItem('covo_ref_at') || 0);
      // Outside the attribution window the creator no longer gets credit.
      if (stored && setAt && Date.now() - setAt > ATTRIBUTION_DAYS * 86400000) {
        localStorage.removeItem('covo_ref');
        localStorage.removeItem('covo_ref_at');
        return null;
      }
      return stored;
    } catch (e) {
      return null;  // private browsing — attribution is best-effort
    }
  }

  var ref = readRef();
  if (!ref) return;

  // Cart attributes ride through checkout and land on the order as
  // note_attributes, which is where the webhook reads them. Without this the
  // ref never leaves the browser and the sale cannot be attributed.
  fetch('/cart/update.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attributes: { covo_ref: ref } }),
  }).catch(function () { /* never block the storefront */ });
})();
</script>
```

## 2. Report — Shopify webhooks

**Where:** Settings → Notifications → Webhooks → Create webhook.
Format **JSON**, API version **2024-01** or later. Create all four:

| Event | URL |
|---|---|
| Order creation | `https://PROJECT_REF.supabase.co/functions/v1/shopify-order-webhook` |
| Order payment | same |
| Order cancellation | same |
| Refund create | same |

Shopify shows a **signing secret** once all webhooks are saved. That secret is
what proves a request came from this store — treat it like a password.

## 3. Register the store with COVO

An admin links the shop domain to the brand and stores the signing secret:

```sql
SELECT public.admin_link_shopify_shop(
  '<brand profile uuid>',
  'thebrand.myshopify.com',
  '<signing secret from step 2>'
);
```

The secret lands in `public.shopify_shops`, which has RLS enabled and **no
policies at all** — no browser session reads it, not even an admin's. Only the
Edge Function, holding the service role, can.

## 4. Deploy

```bash
supabase functions deploy shopify-order-webhook --no-verify-jwt
```

`--no-verify-jwt` is required: Shopify does not send a Supabase JWT, and the
platform's gate would reject the request before the function ran. The HMAC
check inside the function is what authorises it, and it is strictly stronger —
the old JWT gate only proved the caller held *some* valid token.

---

## Notes

**Why the sale amount comes from Shopify.** The previous design had a custom
pixel POST the order value to a public `record-conversion` endpoint. But
`covo_ref` is the affiliate link's id, and it sits in the query string of
every creator's redirect — anyone who had clicked a COVO link could post
invented orders at any amount and mint commissions that would confirm on
schedule and become payable. `record-conversion` now returns **410 Gone**.
Redeploy it to close the old endpoint, then delete it:

```bash
supabase functions deploy record-conversion   # returns 410 from now on
supabase functions delete record-conversion   # once no storefront calls it
```

**Why subtotal and not total.** Total includes shipping and VAT. Paying
commission on those means the brand pays the creator for courier costs and
money owed to SARS. `current_subtotal_price` is used so post-purchase edits
are reflected.

**Why `localStorage` and not a cookie.** The redirect function runs on
`supabase.co` and the store on the brand's domain — a cookie set by one is
unreadable by the other. The ref travels as a URL parameter and is stored
first-party by the snippet above.

**Replays are safe.** Shopify redelivers a webhook until it sees a 200, so
duplicates are the normal case, not an error. The unique constraint on
`(campaign_id, external_order_id)` makes the second delivery a no-op that
still answers 200.

**Refunds close the loop.** The return window only means something if
somebody is told when goods come back. `refunds/create` reduces the commission
proportionally and `orders/cancelled` reverses it entirely. A refund arriving
after the creator has already been paid is *not* clawed back automatically —
it is written to `commissions.notes` and flagged for an admin, because taking
money back out of someone's bank account is a decision, not a trigger.

**A store can only report its own sales.** `record_shopify_conversion` checks
that the campaign behind the `covo_ref` belongs to the brand that signed the
webhook. Without that, a brand could replay a competitor's ref through its own
verified webhook and bill the competitor's escrow.

**Testing.** Place a real order through a creator link using Shopify's Bogus
Gateway (Settings → Payments → test mode). Then:

```sql
SELECT external_order_id, shop_domain, sale_amount, commission_rate,
       gross_commission, platform_fee, net_commission, status, confirms_at
FROM public.commissions ORDER BY created_at DESC LIMIT 5;
```

A commission with `status = 'held'` means the campaign's escrow could not
cover it. Fund the campaign and it is released automatically —
`release_held_commissions()` runs on the Paystack deposit and again nightly.

Shopify's **Recent deliveries** panel under each webhook shows the response
body, which is the fastest way to see *why* an order was not recorded — a
missing `covo_ref`, a paused campaign, or a ref belonging to another brand all
answer 200 with a `reason`.
