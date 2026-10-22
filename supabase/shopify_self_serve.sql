-- ════════════════════════════════════════════════════════════════════
-- COVO — brands connect their own Shopify store
--
-- Until now the only way to link a store was admin_link_shopify_shop(),
-- which an administrator ran by hand in the SQL editor after the brand
-- emailed over their webhook signing secret. Every single onboarding
-- needed a developer, and the secret travelled by email.
--
-- HOW OWNERSHIP IS PROVEN
--
--   Not by asking. A brand types in a shop domain and a signing secret,
--   and the connection sits at 'pending' until a webhook arrives from
--   that domain whose HMAC validates against that secret. Only the real
--   store can produce one: Shopify signs with a secret it shows solely
--   to someone who can reach that store's admin, and the signature is
--   over the raw body.
--
--   So claiming a domain proves nothing and grants nothing. A shop is
--   verified by Shopify talking to us, which is a thing a stranger
--   cannot arrange.
--
-- THE SECRET IS WRITE-ONLY
--
--   Nothing here returns webhook_secret, and shopify_shops still has RLS
--   on with no policies, so no browser session reads the table directly.
--   A brand can set the secret and replace it, and never read it back —
--   because the value is only useful for forging that store's orders.
--
-- A DOMAIN CANNOT BE TAKEN OVER
--
--   admin_link_shopify_shop reassigns brand_id on conflict, which is
--   right for an admin fixing a mistake and would be domain hijacking if
--   a brand could do it: connect a competitor's shop domain, set your own
--   secret, and their real webhooks stop validating. The brand-facing
--   function below refuses a domain that belongs to somebody else.
--
-- Run AFTER shopify_integration.sql (12).
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.shopify_shops
  ADD COLUMN IF NOT EXISTS verified_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Shops linked by an admin before this file existed were only ever
-- created after a real webhook was seen, so they are already proven.
UPDATE public.shopify_shops
SET verified_at = COALESCE(verified_at, connected_at, created_at, NOW())
WHERE verified_at IS NULL;


-- ── Connect ──────────────────────────────────────────────────────────
-- Output names are prefixed on purpose. RETURNS TABLE puts them in scope
-- as plpgsql variables, and an output column called shop_domain would
-- make every unqualified reference to the real column ambiguous — the
-- failure that stopped record_shopify_conversion from executing at all.
CREATE OR REPLACE FUNCTION public.brand_connect_shopify(
  p_shop_domain    TEXT,
  p_webhook_secret TEXT
)
RETURNS TABLE (
  out_connected BOOLEAN,
  out_domain    TEXT,
  out_state     TEXT,
  out_outcome   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _uid    UUID := auth.uid();
  _domain TEXT := LOWER(TRIM(COALESCE(p_shop_domain, '')));
  _secret TEXT := TRIM(COALESCE(p_webhook_secret, ''));
  _owner  UUID;
  _ver    TIMESTAMPTZ;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to connect a store'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = _uid AND p.role = 'brand') THEN
    RAISE EXCEPTION 'Only a brand account can connect a Shopify store'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Strip what people paste by habit: a scheme, a trailing slash, a path.
  _domain := REGEXP_REPLACE(_domain, '^https?://', '');
  _domain := SPLIT_PART(_domain, '/', 1);

  -- Shopify sends the permanent .myshopify.com domain in
  -- x-shopify-shop-domain even when the storefront uses a custom domain,
  -- and that header is what the webhook matches on. Accepting a custom
  -- domain here would create a row no webhook could ever match, and the
  -- brand would wait forever for a verification that cannot arrive.
  IF _domain !~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$' THEN
    RETURN QUERY SELECT false, _domain, 'invalid'::TEXT,
      'That should be your permanent Shopify domain, like yourstore.myshopify.com — not your custom domain.'::TEXT;
    RETURN;
  END IF;

  IF LENGTH(_secret) < 16 THEN
    RETURN QUERY SELECT false, _domain, 'invalid'::TEXT,
      'That does not look like a Shopify signing secret. Copy it from Settings → Notifications → Webhooks, after you have created the webhooks.'::TEXT;
    RETURN;
  END IF;

  SELECT s.brand_id, s.verified_at INTO _owner, _ver
  FROM public.shopify_shops s
  WHERE LOWER(s.shop_domain) = _domain;

  -- Somebody else's shop. Deliberately vague: confirming who owns it
  -- would let anyone enumerate which stores are on COVO.
  IF _owner IS NOT NULL AND _owner <> _uid THEN
    RETURN QUERY SELECT false, _domain, 'taken'::TEXT,
      'That store is already connected to another COVO account. Contact support if it should be yours.'::TEXT;
    RETURN;
  END IF;

  IF _owner = _uid THEN
    -- Re-connecting their own shop replaces the secret, which is how a
    -- brand rotates it after regenerating webhooks. verified_at is kept:
    -- the store was proven once and a new secret does not unprove it,
    -- though the next webhook has to validate against the new value.
    UPDATE public.shopify_shops
    SET webhook_secret = _secret,
        active         = true
    WHERE LOWER(shop_domain) = _domain;

    RETURN QUERY SELECT true, _domain,
      CASE WHEN _ver IS NULL THEN 'pending' ELSE 'verified' END,
      NULL::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.shopify_shops (brand_id, shop_domain, webhook_secret, connected_at)
  VALUES (_uid, _domain, _secret, NOW());

  RETURN QUERY SELECT true, _domain, 'pending'::TEXT, NULL::TEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.brand_connect_shopify(TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.brand_connect_shopify(TEXT, TEXT) TO authenticated;


-- ── What the brand sees ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_shopify_status()
RETURNS TABLE (
  out_domain      TEXT,
  out_state       TEXT,
  out_connected   TIMESTAMPTZ,
  out_verified    TIMESTAMPTZ,
  out_last_hook   TIMESTAMPTZ,
  out_orders      INT,
  out_explanation TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
DECLARE
  _uid UUID := auth.uid();
  _s   RECORD;
  _n   INT;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  SELECT s.shop_domain, s.active, s.connected_at, s.verified_at, s.last_webhook_at
    INTO _s
  FROM public.shopify_shops s
  WHERE s.brand_id = _uid
  ORDER BY s.connected_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::TEXT, 'none'::TEXT, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ, 0,
      'No store connected yet.'::TEXT;
    RETURN;
  END IF;

  SELECT COUNT(*)::INT INTO _n
  FROM public.commissions c
  WHERE c.shop_domain = _s.shop_domain;

  RETURN QUERY SELECT
    _s.shop_domain,
    CASE
      WHEN NOT _s.active            THEN 'disabled'
      WHEN _s.verified_at IS NULL   THEN 'pending'
      ELSE 'verified'
    END,
    _s.connected_at,
    _s.verified_at,
    _s.last_webhook_at,
    _n,
    CASE
      WHEN NOT _s.active THEN
        'This store is switched off. Reconnect it to start tracking orders again.'
      WHEN _s.verified_at IS NULL THEN
        'Waiting for the first signed webhook from your store. Place a test order, '
        || 'or wait for a real one — the connection confirms itself automatically. '
        || 'If it stays here, the signing secret is usually the reason.'
      ELSE
        'Connected. Orders placed through a creator''s link are tracked automatically.'
    END;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.brand_shopify_status() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.brand_shopify_status() TO authenticated;


-- ── Disconnect ───────────────────────────────────────────────────────
-- Deactivates rather than deletes. commissions.shop_domain points at it
-- for every order ever attributed, and the webhook answers 200-and-ignore
-- for an inactive shop, which stops Shopify retrying for days.
CREATE OR REPLACE FUNCTION public.brand_disconnect_shopify()
RETURNS TABLE (out_disconnected BOOLEAN, out_outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _uid UUID := auth.uid();
  _id  UUID;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.shopify_shops
  SET active = false
  WHERE brand_id = _uid AND active
  RETURNING id INTO _id;

  IF _id IS NULL THEN
    RETURN QUERY SELECT false, 'No connected store to disconnect.'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.brand_disconnect_shopify() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.brand_disconnect_shopify() TO authenticated;


-- ── The verification itself ──────────────────────────────────────────
-- Called by shopify-order-webhook once a signature has validated. That
-- is the whole proof of ownership, so it is the only thing that sets
-- verified_at, and it is service_role only — a browser cannot mark its
-- own store verified.
CREATE OR REPLACE FUNCTION public.mark_shopify_webhook_seen(p_shop_domain TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $fn$
  UPDATE public.shopify_shops
  SET last_webhook_at = NOW(),
      verified_at     = COALESCE(verified_at, NOW())
  WHERE LOWER(shop_domain) = LOWER(TRIM(p_shop_domain));
$fn$;

REVOKE EXECUTE ON FUNCTION public.mark_shopify_webhook_seen(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_shopify_webhook_seen(TEXT) TO service_role;


-- ── Verify ───────────────────────────────────────────────────────────
DO $do$
DECLARE _total INT; _pending INT; _leak INT;
BEGIN
  SELECT COUNT(*) INTO _total   FROM public.shopify_shops;
  SELECT COUNT(*) INTO _pending FROM public.shopify_shops WHERE verified_at IS NULL;

  -- No brand-facing function may hand back the signing secret.
  SELECT COUNT(*) INTO _leak
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname LIKE 'brand_%shopify%'
    AND p.prosrc LIKE '%webhook_secret%'
    AND p.prosrc NOT LIKE '%SET webhook_secret%'
    AND p.prosrc NOT LIKE '%webhook_secret, connected_at%';

  RAISE NOTICE 'shopify_shops: % connected, % awaiting first webhook.', _total, _pending;

  IF _leak > 0 THEN
    RAISE WARNING 'A brand-facing function appears to read webhook_secret. Check it before trusting this.';
  ELSE
    RAISE NOTICE 'No brand-facing function returns the signing secret.';
  END IF;

  RAISE NOTICE 'Brands connect their own store now — admin_link_shopify_shop is no longer the only route.';
END;
$do$;
