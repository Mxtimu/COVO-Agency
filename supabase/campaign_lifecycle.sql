-- ════════════════════════════════════════════════════════════════════
-- COVO — the full tranche lifecycle
--
-- Three changes, one of which reverses current behaviour.
--
-- 1. PAUSING NO LONGER STOPS CREATORS EARNING.
--
--    record_shopify_conversion refused any sale on a campaign that was
--    not 'active'. So when a brand's balance ran low, every creator
--    already promoting it stopped earning on work they had already done
--    and posts already published — punished for the brand's shortfall,
--    with nothing they could do about it.
--
--    Pausing now means only what it should: the campaign leaves the
--    browse list and no new affiliate links are minted. Creators who
--    already hold a link keep earning. The money side needs no new
--    mechanism, because 'held' already does exactly the right thing —
--    it records the sale and promises nothing until the brand funds it.
--
--    'closed' still refuses, because a closed campaign is over.
--
-- 2. A LOW-BALANCE WARNING BEFORE THE FLOOR, NOT AT IT.
--
--    The only signal was the pause itself, which arrives when it is
--    already too late. 20% of what has been deposited gives a brand
--    warning while the campaign is still running.
--
-- 3. CLOSING A CAMPAIGN RELEASES WHAT IS LEFT.
--
--    Nothing closed a campaign, so a finished campaign's balance sat
--    committed forever. close_campaign() settles what is owed, works out
--    what is genuinely spare, and marks it refundable. It deliberately
--    does NOT move money — see the note on that function.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.campaign_escrow
  ADD COLUMN IF NOT EXISTS closed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refundable_amount  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS refund_settled_at  TIMESTAMPTZ;

-- The share of deposits below which a brand is warned. 0.20 of what they
-- have put in, so a bigger campaign gets proportionally earlier notice.
ALTER TABLE public.campaign_escrow
  ADD COLUMN IF NOT EXISTS low_balance_ratio NUMERIC(4,3) NOT NULL DEFAULT 0.200;


-- ── Pausing stops invitations, not earnings ──────────────────────────
-- Only the campaign-status guard changes; everything else in this
-- function is as shopify_integration.sql left it.
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
  _fee_rate  NUMERIC := 0.08;
  _floor     NUMERIC := 500;
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

  SELECT ca.id, ca.brand_id, ca.status, ca.commission_rate, ca.return_window_days INTO _campaign
  FROM public.campaigns ca WHERE ca.id = _link.campaign_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Campaign not found', NULL::UUID, 0::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  IF p_brand_id IS NOT NULL AND _campaign.brand_id <> p_brand_id THEN
    RETURN QUERY SELECT false, 'Ref does not belong to this store', NULL::UUID, 0::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  -- Only 'closed' refuses now. A paused campaign still pays the creators
  -- already promoting it: every conversion arrives through an affiliate
  -- link, and a link only exists because an admin approved that creator,
  -- so there is no such thing as a conversion from someone who was not
  -- already invited. Whether the money is there is a separate question,
  -- answered below by pending-vs-held.
  IF _campaign.status = 'closed' THEN
    RETURN QUERY SELECT false, 'Campaign is closed', NULL::UUID, 0::NUMERIC, NULL::TEXT;
    RETURN;
  END IF;

  _gross  := ROUND(_sale * _campaign.commission_rate, 2);
  _fee    := ROUND(_gross * _fee_rate, 2);
  _net    := ROUND(_gross - _fee, 2);
  _window := COALESCE(_campaign.return_window_days, 14);

  SELECT e.id, e.balance, e.status INTO _escrow
  FROM public.campaign_escrow e
  WHERE e.campaign_id = _link.campaign_id
  FOR UPDATE;

  _balance := COALESCE(_escrow.balance, 0);

  SELECT COALESCE(SUM(c.net_commission), 0) INTO _owed
  FROM public.commissions c
  WHERE c.campaign_id = _link.campaign_id
    AND c.status IN ('pending', 'confirmed');

  _covered := _escrow.id IS NOT NULL AND _balance >= ROUND(_owed + _net, 2);
  _status  := CASE WHEN _covered THEN 'pending' ELSE 'held' END;

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
    RETURN QUERY SELECT false, 'Order already recorded', NULL::UUID, 0::NUMERIC, NULL::TEXT;
    RETURN;
  END;

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

REVOKE EXECUTE ON FUNCTION public.record_shopify_conversion(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_shopify_conversion(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID)
  TO service_role;


-- ── Escrow health, for the brand and for the alert job ───────────────
CREATE OR REPLACE FUNCTION public.campaign_escrow_health(p_brand UUID DEFAULT NULL)
RETURNS TABLE (
  campaign_id      UUID,
  campaign_title   TEXT,
  campaign_status  TEXT,
  balance          NUMERIC,
  total_deposited  NUMERIC,
  committed        NUMERIC,
  uncommitted      NUMERIC,
  pct_remaining    NUMERIC,
  health           TEXT,
  held_count       INT,
  held_value       NUMERIC
)
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
  SELECT
    c.id,
    c.title,
    c.status,
    e.balance,
    e.total_deposited,
    COALESCE(liab.committed, 0),
    GREATEST(0, e.balance - COALESCE(liab.committed, 0)),
    CASE WHEN e.total_deposited > 0
         THEN ROUND(e.balance / e.total_deposited * 100, 1)
         ELSE 0 END,
    -- Ordered worst-first: a closed campaign is not "low", and a balance
    -- under the floor matters more than one merely under the ratio.
    CASE
      WHEN e.closed_at IS NOT NULL                        THEN 'closed'
      WHEN e.balance < 500                                THEN 'below_floor'
      WHEN e.total_deposited > 0
       AND e.balance < e.total_deposited * e.low_balance_ratio THEN 'low'
      ELSE 'healthy'
    END,
    COALESCE(held.n, 0),
    COALESCE(held.v, 0)
  FROM public.campaign_escrow e
  JOIN public.campaigns c ON c.id = e.campaign_id
  LEFT JOIN LATERAL (
    SELECT SUM(x.net_commission) AS committed
    FROM public.commissions x
    WHERE x.campaign_id = e.campaign_id AND x.status IN ('pending', 'confirmed')
  ) liab ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INT AS n, SUM(x.net_commission) AS v
    FROM public.commissions x
    WHERE x.campaign_id = e.campaign_id AND x.status = 'held'
  ) held ON true
  WHERE (p_brand IS NULL OR e.brand_id = p_brand)
    AND (e.brand_id = auth.uid() OR public.can_act_as_admin());
$fn$;

REVOKE EXECUTE ON FUNCTION public.campaign_escrow_health(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.campaign_escrow_health(UUID) TO authenticated, service_role;


-- ── Which campaigns need a warning sent ──────────────────────────────
-- Claims them as it returns them, so two runs of the alert job cannot
-- both notify the same brand. Clearing low_balance_notified_at on a
-- top-up is what re-arms it.
CREATE OR REPLACE FUNCTION public.claim_low_balance_alerts()
RETURNS TABLE (
  campaign_id    UUID,
  campaign_title TEXT,
  brand_id       UUID,
  brand_email    TEXT,
  balance        NUMERIC,
  pct_remaining  NUMERIC,
  health         TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT e.id
    FROM public.campaign_escrow e
    WHERE e.closed_at IS NULL
      AND e.low_balance_notified_at IS NULL
      AND e.total_deposited > 0
      AND (e.balance < 500 OR e.balance < e.total_deposited * e.low_balance_ratio)
  ), claimed AS (
    UPDATE public.campaign_escrow e
    SET low_balance_notified_at = NOW()
    WHERE e.id IN (SELECT id FROM due)
    RETURNING e.campaign_id, e.brand_id, e.balance, e.total_deposited
  )
  SELECT cl.campaign_id,
         c.title,
         cl.brand_id,
         p.email,
         cl.balance,
         ROUND(cl.balance / cl.total_deposited * 100, 1),
         CASE WHEN cl.balance < 500 THEN 'below_floor' ELSE 'low' END
  FROM claimed cl
  JOIN public.campaigns c ON c.id = cl.campaign_id
  LEFT JOIN public.profiles p ON p.id = cl.brand_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.claim_low_balance_alerts() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_low_balance_alerts() TO service_role;


-- A top-up re-arms the warning, so the next dip is announced again
-- rather than being silently swallowed by the earlier notice.
CREATE OR REPLACE FUNCTION public.rearm_low_balance_alert(p_campaign_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $fn$
  UPDATE public.campaign_escrow
  SET low_balance_notified_at = NULL
  WHERE campaign_id = p_campaign_id
    AND balance >= GREATEST(500, total_deposited * low_balance_ratio);
$fn$;

REVOKE EXECUTE ON FUNCTION public.rearm_low_balance_alert(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rearm_low_balance_alert(UUID) TO service_role;


-- ── Closing a campaign ───────────────────────────────────────────────
-- Works out what is genuinely spare and records it as refundable. It
-- deliberately moves NO money.
--
-- Returning a deposit is not one obvious action: a Paystack refund goes
-- back to the card that paid and fails once that card has expired; a
-- credit against the brand's next campaign is simpler but is not a
-- refund; a bank transfer needs details COVO does not hold for brands.
-- Picking one silently would be deciding for the brand what happens to
-- their money. So this makes the amount explicit and leaves the choice
-- to whoever is entitled to make it.
CREATE OR REPLACE FUNCTION public.close_campaign(p_campaign_id UUID)
RETURNS TABLE (
  closed            BOOLEAN,
  outcome           TEXT,
  refundable        NUMERIC,
  still_committed   NUMERIC,
  held_released     INT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _escrow    RECORD;
  _committed NUMERIC;
  _rel       RECORD;
  _spare     NUMERIC;
BEGIN
  SELECT e.id, e.brand_id, e.balance, e.closed_at INTO _escrow
  FROM public.campaign_escrow e
  WHERE e.campaign_id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'No escrow account for that campaign.', 0::NUMERIC, 0::NUMERIC, 0;
    RETURN;
  END IF;

  IF NOT (_escrow.brand_id = auth.uid() OR public.can_act_as_admin()) THEN
    RAISE EXCEPTION 'Only the brand or a COVO admin may close this campaign'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _escrow.closed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'That campaign is already closed.', _escrow.balance, 0::NUMERIC, 0;
    RETURN;
  END IF;

  -- Anything held that the balance can now cover is released first. A
  -- creator who earned during a funding gap is owed it whether or not the
  -- brand is finished with the campaign.
  SELECT * INTO _rel FROM public.release_held_commissions(p_campaign_id);

  SELECT COALESCE(SUM(c.net_commission), 0) INTO _committed
  FROM public.commissions c
  WHERE c.campaign_id = p_campaign_id
    AND c.status IN ('pending', 'confirmed');

  -- The balance itself is unchanged by the release above —
  -- release_held_commissions only moves commissions held -> pending, and
  -- money leaves the balance at payout, not at release. So the figure
  -- read under the lock is still good; what changed is _committed, which
  -- is why it is counted after the release and not before.
  --
  -- Commissions still inside their return window are not spare: they are
  -- owed, they just have not cleared yet.
  _spare := GREATEST(0, ROUND(_escrow.balance - _committed, 2));

  UPDATE public.campaign_escrow
  SET status            = 'closed',
      closed_at         = NOW(),
      refundable_amount = _spare
  WHERE id = _escrow.id;

  UPDATE public.campaigns SET status = 'closed' WHERE id = p_campaign_id;

  RETURN QUERY SELECT true, NULL::TEXT, _spare, _committed,
                      COALESCE(_rel.released_count, 0);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.close_campaign(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.close_campaign(UUID) TO authenticated, service_role;


-- ── New links are not minted for a paused campaign ───────────────────
-- The other half of "no new invitations". generate-affiliate-assets also
-- checks this, but an admin approving through any other path should hit
-- the same rule.
CREATE OR REPLACE FUNCTION public.campaign_accepts_new_creators(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.campaigns c
    JOIN public.campaign_escrow e ON e.campaign_id = c.id
    WHERE c.id = p_campaign_id
      AND c.status = 'active'
      AND e.closed_at IS NULL
      AND e.balance >= 500
  );
$fn$;

REVOKE EXECUTE ON FUNCTION public.campaign_accepts_new_creators(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.campaign_accepts_new_creators(UUID) TO authenticated, service_role;


DO $do$
DECLARE _low INT; _floor INT;
BEGIN
  SELECT COUNT(*) FILTER (WHERE health = 'low'),
         COUNT(*) FILTER (WHERE health = 'below_floor')
    INTO _low, _floor
  FROM public.campaign_escrow_health(NULL);

  RAISE NOTICE 'escrow health: % campaign(s) low, % below the R500 floor.', _low, _floor;
  RAISE NOTICE 'Paused campaigns now keep paying creators who already hold a link — only new invitations stop.';
END;
$do$;
