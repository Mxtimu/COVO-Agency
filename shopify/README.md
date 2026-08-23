# COVO — Shopify integration

Two snippets. Both are required: the first captures the attribution when a
shopper arrives, the second reports the sale when they check out. Neither
contains a secret, so they are safe to paste into a public storefront.

Replace `PROJECT_REF` in both with the COVO Supabase project ref
(`nyeulzucksldwlcrbbmo`).

---

## 1. Capture — `theme.liquid`

Shoppers arriving from a creator's link land with `?covo_ref=...` on the URL.
That parameter disappears as soon as they browse to another page, so it has to
be persisted immediately, in the shop's own first-party storage.

**Where:** Online Store → Themes → Edit code → `layout/theme.liquid`, just
before `</head>`.
another change 
```html
<script>
(function () {
  var ATTRIBUTION_DAYS = 30;
  try {
    var ref = new URLSearchParams(window.location.search).get('covo_ref');
    if (ref) {
      localStorage.setItem('covo_ref', ref);
      localStorage.setItem('covo_ref_at', Date.now());
    }
  } catch (e) { /* private browsing — attribution is best-effort */ }
})();
</script>
```

## 2. Report — Customer events pixel

**Where:** Settings → Customer events → Add custom pixel. Name it `COVO`.
Set permissions to **Not required** (it stores no personal data) and click
Connect after saving.

```js
const PROJECT_REF = 'PROJECT_REF';
const ATTRIBUTION_DAYS = 30;

analytics.subscribe('checkout_completed', (event) => {
  let ref, setAt;
  try {
    ref   = localStorage.getItem('covo_ref');
    setAt = Number(localStorage.getItem('covo_ref_at') || 0);
  } catch (e) { return; }

  if (!ref) return;

  // Outside the attribution window the creator no longer gets credit.
  if (setAt && Date.now() - setAt > ATTRIBUTION_DAYS * 86400000) {
    try { localStorage.removeItem('covo_ref'); } catch (e) {}
    return;
  }

  const checkout = event.data.checkout;

  fetch(`https://${PROJECT_REF}.supabase.co/functions/v1/record-conversion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref: ref,
      order_id: checkout.order.id,
      // subtotal excludes shipping and tax — commission is owed on goods only
      order_value: checkout.subtotalPrice.amount,
      currency: checkout.subtotalPrice.currencyCode,
    }),
    keepalive: true,
  }).catch(() => { /* never block the confirmation page */ });
});
```

---

## Notes

**Why `subtotalPrice` and not `totalPrice`.** Total includes shipping and VAT.
Paying commission on those means the brand pays the creator for courier costs
and money owed to SARS. Change it deliberately if the brand wants otherwise.

**Why `localStorage` and not a cookie.** The redirect function runs on
`supabase.co` and the store on the brand's domain — a cookie set by one is
unreadable by the other. The ref travels as a URL parameter and is stored
first-party by the snippet above.

**Replays are safe.** `record-conversion` enforces a unique constraint on
`(campaign_id, external_order_id)`, so a refreshed confirmation page returns
`already recorded` rather than paying the creator twice.

**Custom pixels are sandboxed.** Shopify runs them in a worker with no access
to the storefront's `window`, which is why capture lives in `theme.liquid`
while reporting lives in the pixel. `localStorage` is shared across both.

**Testing.** Place a real order through a creator link using Shopify's Bogus
Gateway (Settings → Payments → test mode). Then:

```sql
SELECT external_order_id, sale_amount, gross_commission, platform_fee,
       net_commission, status, confirms_at
FROM public.commissions ORDER BY created_at DESC;
```
trying to fix this 