-- ════════════════════════════════════════════════════════════════════
-- COVO — Shopify order webhooks
--
-- record-conversion took the sale amount from the shopper's browser. It
-- had to: it ran as a custom pixel on the brand's domain, where there is
-- no COVO session to authenticate against. Its own header comment argued
-- that safety came from needing "a real affiliate link and a real order
-- id" — but the link id is the covo_ref sitting in the query string of
-- every creator's redirect, and the order id was whatever the caller
-- typed. The unique constraint stopped replays, not invention. Anyone
-- who had ever clicked a COVO link could mint commissions at any value.
--
-- Shopify signs its webhooks. Moving the report server-side means the
-- sale amount arrives from Shopify over a channel the shopper cannot
-- reach, and the browser's only remaining job is to remember which
-- creator sent them — which is not worth forging.
--
-- This file holds the shop registry and the commission write itself.
-- The write moved into the database so that the solvency check and the
-- insert happen under one lock: the old function read the escrow
-- balance, then inserted, and two orders landing together could both
-- read the same balance and both pass.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── Shop registry ────────────────────────────────────────────────────
-- Maps a Shopify store to the COVO brand behind it, and holds the secret
-- its webhooks are signed with.
CREATE TABLE IF NOT EXISTS public.shopify_shops (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shop_domain    TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shopify_shops_domain_key
  ON public.shopify_shops (LOWER(shop_domain));
CREATE INDEX IF NOT EXISTS idx_shopify_shops_brand ON public.shopify_shops (brand_id);

DROP TRIGGER IF EXISTS set_updated_at_shopify_shops ON public.shopify_shops;
CREATE TRIGGER set_updated_at_shopify_shops
  BEFORE UPDATE ON public.shopify_shops
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- RLS on, and deliberately NO policies. webhook_secret is the one value
-- that lets anything speak for this shop, so no browser session reaches
-- this table at all — not the brand's, not an admin's. The Edge Function
-- reads it with the service role, which bypasses RLS; admins manage the
-- mapping through the RPCs below, which never return the secret.
ALTER TABLE public.shopify_shops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage shopify shops" ON public.shopify_shops;


-- ── Admin management, without ever handing back the secret ───────────
-- The OUT columns are deliberately NOT named shop_domain or brand_id.
-- RETURNS TABLE puts those names in scope as variables, and the ON CONFLICT
-- target below is an expression over the column of the same name — which
-- would make it ambiguous and fail on the first call. Dropped first because
-- CREATE OR REPLACE cannot rename an OUT parameter.
DROP FUNCTION IF EXISTS public.admin_link_shopify_shop(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_link_shopify_shop(
  p_brand_id       UUID,
  p_shop_domain    TEXT,
  p_webhook_secret TEXT
)
RETURNS TABLE (linked_shop_id UUID, linked_domain TEXT, linked_brand_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _domain TEXT := LOWER(TRIM(p_shop_domain));
  _id     UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator may link a Shopify store'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _domain IS NULL OR _domain = '' THEN
    RAISE EXCEPTION 'A shop domain is required';
  END IF;
  IF p_webhook_secret IS NULL OR LENGTH(TRIM(p_webhook_secret)) < 16 THEN
    RAISE EXCEPTION 'That does not look like a Shopify webhook secret';
  END IF;

  INSERT INTO public.shopify_shops (brand_id, shop_domain, webhook_secret)
  VALUES (p_brand_id, _domain, TRIM(p_webhook_secret))
  ON CONFLICT (LOWER(shop_domain)) DO UPDATE
    SET brand_id       = EXCLUDED.brand_id,
        webhook_secret = EXCLUDED.webhook_secret,
        active         = true
  RETURNING id INTO _id;

  RETURN QUERY SELECT _id, _domain, p_brand_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_list_shopify_shops()
RETURNS TABLE (id UUID, brand_id UUID, shop_domain TEXT, active BOOLEAN, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator may list linked stores'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- webhook_secret is deliberately not in the column list.
  RETURN QUERY
    SELECT s.id, s.brand_id, s.shop_domain, s.active, s.created_at
    FROM public.shopify_shops s
    ORDER BY s.created_at DESC;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.admin_link_shopify_shop(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_shopify_shops()                FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_link_shopify_shop(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.admin_list_shopify_shops()                TO authenticated, service_role;


-- ── commission_rate is a fraction, and the default said otherwise ────
-- The column is NUMERIC(5,2) DEFAULT 10 while every writer and reader
-- treats it as a fraction (0.15 = 15%). Any insert that omitted the rate
-- therefore created a campaign paying 1000% commission, and 12.5% was
-- silently rounded to 13% by the 2-decimal scale.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM public.campaigns WHERE commission_rate > 1) THEN
    RAISE WARNING 'commission_rate: % campaign(s) store a value > 1 and look like whole percentages. Left untouched — inspect them before widening the column.',
      (SELECT COUNT(*) FROM public.campaigns WHERE commission_rate > 1);
  ELSE
    ALTER TABLE public.campaigns ALTER COLUMN commission_rate TYPE NUMERIC(5,4);
  END IF;

  ALTER TABLE public.campaigns ALTER COLUMN commission_rate SET DEFAULT 0.10;
END;
$do$;

-- Added NOT VALID so a project still holding whole-percentage rates can run
-- this file: the constraint binds every new write immediately and the old
-- rows are checked once they have been corrected, with
--   ALTER TABLE public.campaigns VALIDATE CONSTRAINT campaigns_commission_rate_check;
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_commission_rate_check;
ALTER TABLE public.campaigns ADD  CONSTRAINT campaigns_commission_rate_check
  CHECK (commission_rate > 0 AND commission_rate <= 0.8) NOT VALID;


-- ── Order provenance ─────────────────────────────────────────────────
ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS shop_domain TEXT,
  ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12,2) NOT NULL DEFAULT 0;


-- ════════════════════════════════════════════════════════════════════
-- The commission write
--
-- One function, one transaction, one lock. Everything the old Edge
-- Function did across four round trips — resolve the link, check the
-- campaign, sum outstanding liabilities, decide covered vs held, insert
-- — happens here while the campaign's escrow row is held FOR UPDATE, so
-- two simultaneous orders cannot both be told the same balance covers
-- them.
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.record_shopify_conversion(
  p_link_id     UUID,
  p_order_id    TEXT,
  p_sale_amount NUMERIC,
  p_currency    TEXT    DEFAULT 'ZAR',
  p_shop_domain TEXT    DEFAULT NULL,
  p_brand_id    UUID    DEFAULT NULL
)
RETURNS TABLE (
  recorded       BOOLEAN,
  reason         TEXT,
  commission_id  UUID,
  net_commission NUMERIC,
  status         TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _link      RECORD;
  _campaign  RECORD;
  _escrow    RECORD;
  _fee_rate  NUMERIC := 0.08;   -- COVO takes 8% of gross commission
  _floor     NUMERIC := 500;    -- ZAR — below this the campaign pauses
  _sale      NUMERIC;
  _gross     NUMERIC;
  _fee       NUMERIC;
  _net       NUMERIC;
  _owed      NUMERIC;
  _balance   NUMERIC;
  _covered   BOOLEAN;
  _status    TEXT;
  _window    INT;
  _click     UUID;
  _new       UUID;
BEGIN
  IF p_sale_amount IS NULL OR p_sale_amount <= 0 THEN
    RETURN QUERY SELECT false, 'Sale amount must be positive', NULL::UUID, 0::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  _sale := ROUND(p_sale_amount, 2);

  SELECT l.id, l.creator_id, l.campaign_id, l.product_id INTO _link
  FROM public.affiliate_links l WHERE l.id = p_link_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Unknown ref', NULL::UUID, 0::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  -- `status` is an OUT column of this function, so an unqualified
  -- reference here is ambiguous against campaigns.status. This is the
  -- first of three such sites and the one that fired first.
  SELECT ca.id, ca.brand_id, ca.status, ca.commission_rate, ca.return_window_days INTO _campaign
  FROM public.campaigns ca WHERE ca.id = _link.campaign_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Campaign not found', NULL::UUID, 0::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  -- The shop that signed the webhook must own the campaign the ref points
  -- at. Without this a brand could replay a competitor's covo_ref through
  -- its own verified webhook and bill the competitor's escrow.
  IF p_brand_id IS NOT NULL AND _campaign.brand_id <> p_brand_id THEN
    RETURN QUERY SELECT false, 'Ref does not belong to this store', NULL::UUID, 0::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF _campaign.status <> 'active' THEN
    RETURN QUERY SELECT false, 'Campaign is ' || _campaign.status, NULL::UUID, 0::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  _gross  := ROUND(_sale * _campaign.commission_rate, 2);
  _fee    := ROUND(_gross * _fee_rate, 2);
  _net    := ROUND(_gross - _fee, 2);
  _window := COALESCE(_campaign.return_window_days, 14);

  -- Every table below is aliased and every column qualified, and that is
  -- load-bearing rather than tidiness. RETURNS TABLE puts `status` and
  -- `net_commission` in scope as OUT variables, so an unqualified
  -- reference to either is ambiguous against the column of the same name
  -- and Postgres refuses to run the function at all — "column reference
  -- 'status' is ambiguous", on every single call. Caught by
  -- test_money_paths.sql before a real order ever reached it.

  -- Serialise every conversion on this campaign behind its escrow row.
  SELECT e.id, e.balance, e.status INTO _escrow
  FROM public.campaign_escrow e
  WHERE e.campaign_id = _link.campaign_id
  FOR UPDATE;

  _balance := COALESCE(_escrow.balance, 0);

  SELECT COALESCE(SUM(c.net_commission), 0) INTO _owed
  FROM public.commissions c
  WHERE c.campaign_id = _link.campaign_id
    AND c.status IN ('pending', 'confirmed');

  -- Existing liabilities count, not just this sale: ten orders each
  -- individually under the balance must not all pass against it.
  _covered := _escrow.id IS NOT NULL AND _balance >= ROUND(_owed + _net, 2);

  -- 'held' records the sale and shows it to both sides, but promises the
  -- creator nothing until the brand funds the campaign. Rejecting outright
  -- would penalise the creator for the brand's shortfall — they did the
  -- work. release_held_commissions() pays them the moment it is funded.
  _status := CASE WHEN _covered THEN 'pending' ELSE 'held' END;

  SELECT ck.id INTO _click
  FROM public.clicks ck
  WHERE ck.affiliate_link_id = _link.id
  ORDER BY ck.clicked_at DESC
  LIMIT 1;

  BEGIN
    INSERT INTO public.commissions (
      creator_id, campaign_id, product_id, affiliate_link_id, click_id,
      external_order_id, shop_domain, sale_amount, currency, commission_rate,
      gross_commission, platform_fee, net_commission, status,
      return_window_days, confirms_at, source
    ) VALUES (
      _link.creator_id, _link.campaign_id, _link.product_id, _link.id, _click,
      p_order_id, p_shop_domain, _sale, UPPER(COALESCE(p_currency, 'ZAR')),
      _campaign.commission_rate, _gross, _fee, _net, _status,
      _window, NOW() + (_window || ' days')::INTERVAL, 'shopify'
    )
    RETURNING id INTO _new;
  EXCEPTION WHEN unique_violation THEN
    -- (campaign_id, external_order_id) — Shopify redelivers a webhook
    -- until it sees a 200, so this is the normal retry path, not an error.
    RETURN QUERY SELECT false, 'Order already recorded', NULL::UUID, 0::NUMERIC, NULL::TEXT;
    RETURN;
  END;

  -- Either the balance has fallen under the floor, or it can no longer
  -- cover what is owed. Both mean it must stop accruing new liability.
  IF _escrow.id IS NOT NULL AND _escrow.status = 'active'
     AND (NOT _covered OR _balance < _floor) THEN
    UPDATE public.campaign_escrow
    SET status = 'paused', low_balance_notified_at = COALESCE(low_balance_notified_at, NOW())
    WHERE id = _escrow.id;
    UPDATE public.campaigns SET status = 'paused' WHERE id = _link.campaign_id;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT, _new, _net, _status;
END;
$fn$;

-- Only the Edge Function may call this, and it holds the service role.
REVOKE EXECUTE ON FUNCTION public.record_shopify_conversion(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_shopify_conversion(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID)
  TO service_role;


-- ════════════════════════════════════════════════════════════════════
-- Refunds
--
-- The return window exists because goods come back. Nothing was ever
-- told when they did, so a refunded order still paid out on schedule and
-- the window was decorative. Shopify's refunds/create webhook is what
-- closes that loop.
--
-- A partial refund reduces the commission proportionally; a refund that
-- takes the order to zero denies it outright. A commission already paid
-- is left alone and flagged for an admin — clawing back money already in
-- a creator's bank account is a decision, not a trigger.
-- ════════════════════════════════════════════════════════════════════
-- Keyed on the brand rather than the campaign: a refund webhook carries the
-- order and the shop, never the covo_ref, so the commission has to be found
-- from the store that sent it.
--
-- Dropped first: CREATE OR REPLACE cannot rename an input parameter, so an
-- earlier (p_campaign_id, ...) definition of the same signature would make
-- this file fail on a re-run.
DROP FUNCTION IF EXISTS public.apply_shopify_refund(UUID, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.apply_shopify_refund(
  p_brand_id        UUID,
  p_order_id        TEXT,
  p_refunded_amount NUMERIC
)
RETURNS TABLE (applied BOOLEAN, reason TEXT, new_status TEXT, new_net NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _c        RECORD;
  _fee_rate NUMERIC := 0.08;
  _refunded NUMERIC;
  _remain   NUMERIC;
  _gross    NUMERIC;
  _fee      NUMERIC;
  _net      NUMERIC;
  _status   TEXT;
BEGIN
  SELECT c.* INTO _c
  FROM public.commissions c
  JOIN public.campaigns ca ON ca.id = c.campaign_id
  WHERE c.external_order_id = p_order_id
    AND ca.brand_id = p_brand_id
  FOR UPDATE OF c;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'No commission for that order', NULL::TEXT, 0::NUMERIC;
    RETURN;
  END IF;

  IF _c.status = 'paid' THEN
    UPDATE public.commissions
    SET refunded_amount = GREATEST(refunded_amount, ROUND(p_refunded_amount, 2)),
        notes = COALESCE(notes || E'\n', '') ||
                'Refund of ' || ROUND(p_refunded_amount, 2) ||
                ' received after payout on ' || NOW()::date || ' — needs review.'
    WHERE id = _c.id;

    RETURN QUERY SELECT false, 'Already paid out — flagged for admin review', _c.status, _c.net_commission;
    RETURN;
  END IF;

  -- Shopify sends the refund line, not a running total; accumulate.
  _refunded := ROUND(_c.refunded_amount + p_refunded_amount, 2);
  _remain   := GREATEST(0, ROUND(_c.sale_amount - _refunded, 2));

  _gross  := ROUND(_remain * _c.commission_rate, 2);
  _fee    := ROUND(_gross * _fee_rate, 2);
  _net    := ROUND(_gross - _fee, 2);
  _status := CASE WHEN _remain <= 0 THEN 'denied' ELSE _c.status END;

  UPDATE public.commissions
  SET refunded_amount  = _refunded,
      gross_commission = _gross,
      platform_fee     = _fee,
      net_commission   = _net,
      status           = _status,
      notes            = COALESCE(notes || E'\n', '') ||
                         'Refund of ' || ROUND(p_refunded_amount, 2) || ' applied ' || NOW()::date
  WHERE id = _c.id;

  RETURN QUERY SELECT true, NULL::TEXT, _status, _net;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.apply_shopify_refund(UUID, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_shopify_refund(UUID, TEXT, NUMERIC) TO service_role;
