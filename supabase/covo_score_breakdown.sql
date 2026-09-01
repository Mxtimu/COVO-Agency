-- ════════════════════════════════════════════════════════════════════
-- COVO Score — show the working
--
-- calculate_covo_score() returned a bare integer, and only brands and
-- admins ever saw it. The creator it describes had no way to see their
-- own number, let alone why it was what it was — while the signup page
-- sells them "a COVO Score that brands compete for". A score you are
-- judged on but cannot inspect is not a differentiator, it is a black
-- box, and it cannot change anyone's behaviour because nobody knows
-- which behaviour to change.
--
-- This exposes the components. The important part is that
-- calculate_covo_score() is now defined IN TERMS OF this function rather
-- than alongside it: two copies of the same arithmetic would drift, and
-- the day they disagreed the breakdown would be quietly lying about how
-- the number was reached.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── The arithmetic, with no authorisation check ──────────────────────
-- Internal. The nightly cron, refresh_covo_score() and the
-- on-commission trigger all reach the score with no JWT at all, so
-- auth.uid() is NULL for them. Putting the caller check in here would
-- have broken every automatic recalculation on the platform while
-- looking perfectly correct from the browser. The check lives in the
-- public wrapper below instead.
CREATE OR REPLACE FUNCTION public.covo_score_components(p_creator UUID)
RETURNS TABLE (
  clicks             INT,
  sales              INT,
  denied             INT,
  disputes           INT,
  avg_order          NUMERIC,
  conv_rate          NUMERIC,
  confidence         NUMERIC,
  conversion_points  NUMERIC,
  volume_points      NUMERIC,
  order_value_points NUMERIC,
  reliability_points NUMERIC,
  total              INT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
DECLARE
  _clicks     INT;
  _sales      INT;
  _denied     INT;
  _disputes   INT;
  _avg_order  NUMERIC;
  _conv_rate  NUMERIC := 0;
  _confidence NUMERIC := 0;
  _conv_pts   NUMERIC := 0;
  _vol_pts    NUMERIC := 0;
  _aov_pts    NUMERIC := 0;
  _rel_pts    NUMERIC := 0;
  _total      INT;
BEGIN
  SELECT COUNT(*) INTO _clicks FROM public.clicks WHERE creator_id = p_creator;

  SELECT COUNT(*) FILTER (WHERE status <> 'denied'),
         COUNT(*) FILTER (WHERE status = 'denied'),
         COALESCE(AVG(sale_amount) FILTER (WHERE status <> 'denied'), 0)
    INTO _sales, _denied, _avg_order
  FROM public.commissions WHERE creator_id = p_creator;

  SELECT COUNT(*) INTO _disputes
  FROM public.disputes d
  JOIN public.commissions c ON c.id = d.commission_id
  WHERE c.creator_id = p_creator AND d.status IN ('open','under_review','resolved');

  -- Nothing to judge yet — reads as "unproven", not "bad".
  IF _clicks = 0 AND _sales = 0 THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC,
                        0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0;
    RETURN;
  END IF;

  -- Confidence: how much the evidence is worth believing. Full at 20 sales.
  _confidence := LEAST(1.0, _sales::NUMERIC / 20.0);

  -- Conversion rate: 40 pts, full marks at 5%, smoothed toward a 2%
  -- industry prior with 200 pseudo-clicks of inertia.
  IF _clicks > 0 THEN
    _conv_rate := (_sales::NUMERIC + 0.02 * 200) / (_clicks::NUMERIC + 200);
    _conv_pts  := LEAST(40, (_conv_rate / 0.05) * 40);
  END IF;

  -- Volume: 25 pts, logarithmic, full marks at 50 sales. This is the
  -- evidence itself, so deliberately not confidence-scaled.
  IF _sales > 0 THEN
    _vol_pts := LEAST(25, (LN(_sales + 1) / LN(51)) * 25);
  END IF;

  -- Average order value: 15 pts, full marks at R2 000.
  _aov_pts := LEAST(15, (_avg_order / 2000) * 15) * _confidence;

  -- Reliability: 20 pts, lost to denials and disputes.
  _rel_pts := 20;
  IF (_sales + _denied) > 0 THEN
    _rel_pts := _rel_pts - (_denied::NUMERIC / (_sales + _denied)) * 15;
  END IF;
  _rel_pts := _rel_pts * _confidence;
  -- Penalties are NOT scaled — a dispute counts fully from day one.
  _rel_pts := GREATEST(0, _rel_pts - LEAST(10, _disputes * 5));

  _total := LEAST(100, GREATEST(0, ROUND(_conv_pts + _vol_pts + _aov_pts + _rel_pts)))::INT;

  RETURN QUERY SELECT
    _clicks, _sales, _denied, _disputes,
    ROUND(_avg_order, 2), ROUND(_conv_rate * 100, 2), ROUND(_confidence, 4),
    ROUND(_conv_pts, 1), ROUND(_vol_pts, 1), ROUND(_aov_pts, 1), ROUND(_rel_pts, 1),
    _total;
END;
$fn$;

-- Never callable from a browser: it would hand any signed-in user any
-- creator's click and sales history.
REVOKE EXECUTE ON FUNCTION public.covo_score_components(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.covo_score_components(UUID) TO service_role;


-- ── The public view of it, with the caller check ─────────────────────
-- A creator sees their own; an admin sees anyone's; a brand sees the
-- creators actually promoting its campaigns — the same boundary the
-- brands-read-their-campaign-creators policy draws.
CREATE OR REPLACE FUNCTION public.covo_score_breakdown(p_creator UUID)
RETURNS TABLE (
  clicks             INT,
  sales              INT,
  denied             INT,
  disputes           INT,
  avg_order          NUMERIC,
  conv_rate          NUMERIC,
  confidence         NUMERIC,
  conversion_points  NUMERIC,
  volume_points      NUMERIC,
  order_value_points NUMERIC,
  reliability_points NUMERIC,
  total              INT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
STABLE
AS $wrap$
BEGIN
  IF NOT (
    p_creator = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.affiliate_links l
      JOIN public.campaigns c ON c.id = l.campaign_id
      WHERE l.creator_id = p_creator AND c.brand_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Not authorised to view this score'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY SELECT * FROM public.covo_score_components(p_creator);
END;
$wrap$;

REVOKE EXECUTE ON FUNCTION public.covo_score_breakdown(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.covo_score_breakdown(UUID) TO authenticated, service_role;


-- ── The score is now the sum of its parts, by construction ───────────
-- Previously this held its own copy of the arithmetic. Two copies drift,
-- and a breakdown that disagrees with the score is worse than no
-- breakdown at all — so there is only one copy now, and this reads it.
CREATE OR REPLACE FUNCTION public.calculate_covo_score(p_creator UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
  SELECT total FROM public.covo_score_components(p_creator);
$fn$;

-- Nothing in the client calls this — the browser goes through
-- covo_score_breakdown(), which checks who is asking. Keeping the grant
-- off `authenticated` means a signed-in user cannot read an arbitrary
-- creator's score by uuid. refresh_covo_score() still reaches it, because
-- that is SECURITY DEFINER and runs as the owner.
REVOKE EXECUTE ON FUNCTION public.calculate_covo_score(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.calculate_covo_score(UUID) TO service_role;


-- ── Verify the refactor did not move anyone's score ──────────────────
-- The whole point was that the number stays identical and only becomes
-- explicable. If any stored score disagrees with a fresh calculation by
-- more than rounding, this says so instead of silently repricing people.
DO $do$
DECLARE
  _drift INT;
BEGIN
  SELECT COUNT(*) INTO _drift
  FROM public.creator_profiles cp
  WHERE cp.covo_score IS DISTINCT FROM public.calculate_covo_score(cp.id);

  IF _drift > 0 THEN
    RAISE NOTICE 'covo_score: % creator(s) have a stored score that differs from a fresh calculation.', _drift;
    RAISE NOTICE 'That is expected if commissions changed since the last nightly run. To resync: SELECT public.refresh_all_covo_scores();';
  ELSE
    RAISE NOTICE 'covo_score: every stored score matches a fresh calculation.';
  END IF;
END;
$do$;
