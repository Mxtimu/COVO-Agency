-- ════════════════════════════════════════════════════════════════════
-- COVO Score — computed, not typed in
--
-- The score is what a brand is really buying: a defensible answer to
-- "why this creator?". An admin entering a number by hand cannot answer
-- that, so it is derived from what the creator has actually done.
--
--   Conversion rate   40 pts — do their clicks turn into sales?
--   Sales volume      25 pts — is there enough evidence to trust it?
--   Average order     15 pts — do they bring buyers who spend?
--   Reliability       20 pts — returns and disputes against them
--
-- Conversion, order value and reliability are scaled by a confidence
-- factor that grows to full at 20 sales, so a score has to be earned
-- with evidence rather than won on one lucky click.
--
-- A creator with no history scores 0 and reads as "unproven" rather than
-- "bad" in the UI.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.calculate_covo_score(p_creator UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
STABLE
AS $$
DECLARE
  _clicks      INT;
  _sales       INT;
  _denied      INT;
  _disputes    INT;
  _avg_order   NUMERIC;
  _conv_rate   NUMERIC;
  _score       NUMERIC := 0;
  _confidence  NUMERIC := 0;
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

  -- Nothing to judge yet.
  IF _clicks = 0 AND _sales = 0 THEN
    RETURN 0;
  END IF;

  -- ── Confidence ────────────────────────────────────────────────────
  -- How much the evidence is worth believing. Two sales tell you almost
  -- nothing about a creator; twenty tell you a great deal. Without this,
  -- one lucky sale off three clicks reads as a 100% conversion rate and
  -- saturates the score — a creator with 2 sales would rank alongside one
  -- with 200, which is the first thing a brand would notice.
  _confidence := LEAST(1.0, _sales::NUMERIC / 20.0);

  -- ── Conversion rate: 40 pts, full marks at 5% ─────────────────────
  -- Smoothed toward a 2% industry prior with 200 pseudo-clicks of inertia,
  -- so an extreme rate from a tiny sample is pulled back toward normal and
  -- only earns its keep once real traffic backs it up.
  IF _clicks > 0 THEN
    _conv_rate := (_sales::NUMERIC + 0.02 * 200) / (_clicks::NUMERIC + 200);
    _score := _score + LEAST(40, (_conv_rate / 0.05) * 40);
  END IF;

  -- ── Volume: 25 pts, full marks at 50 sales ────────────────────────
  -- Logarithmic: the difference between 1 and 10 sales says far more
  -- about reliability than the difference between 40 and 50. This is the
  -- evidence itself, so it is deliberately not confidence-scaled.
  IF _sales > 0 THEN
    _score := _score + LEAST(25, (LN(_sales + 1) / LN(51)) * 25);
  END IF;

  -- ── Average order value: 15 pts, full marks at R2 000 ─────────────
  _score := _score + LEAST(15, (_avg_order / 2000) * 15) * _confidence;

  -- ── Reliability: 20 pts, lost to denials and disputes ─────────────
  -- Also confidence-scaled: a clean record over two sales is not yet
  -- evidence of reliability, so it cannot bank the full twenty points.
  DECLARE
    _reliability NUMERIC := 20;
    _total       INT := _sales + _denied;
  BEGIN
    IF _total > 0 THEN
      _reliability := _reliability - (_denied::NUMERIC / _total) * 15;
    END IF;
    _reliability := _reliability * _confidence;
    -- Penalties are NOT scaled — a dispute counts fully from day one.
    _reliability := _reliability - LEAST(10, _disputes * 5);
    _score := _score + GREATEST(0, _reliability);
  END;

  RETURN LEAST(100, GREATEST(0, ROUND(_score)))::INTEGER;
END;
$$;

-- Recalculate one creator and persist it.
CREATE OR REPLACE FUNCTION public.refresh_covo_score(p_creator UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE _score INT;
BEGIN
  _score := public.calculate_covo_score(p_creator);

  INSERT INTO public.creator_profiles (id, covo_score, covo_score_updated_at)
  VALUES (p_creator, _score, NOW())
  ON CONFLICT (id) DO UPDATE
    SET covo_score = EXCLUDED.covo_score,
        covo_score_updated_at = EXCLUDED.covo_score_updated_at;

  RETURN _score;
END;
$$;

-- Recalculate everyone — used by the nightly job.
CREATE OR REPLACE FUNCTION public.refresh_all_covo_scores()
RETURNS TABLE (creators_updated INT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE _n INT := 0; _row RECORD;
BEGIN
  FOR _row IN SELECT id FROM public.profiles WHERE role = 'creator' LOOP
    PERFORM public.refresh_covo_score(_row.id);
    _n := _n + 1;
  END LOOP;
  RETURN QUERY SELECT _n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_all_covo_scores()   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refresh_covo_score(UUID)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calculate_covo_score(UUID)  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.refresh_covo_score(UUID)    TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.refresh_all_covo_scores()   TO service_role;

-- ── Keep scores current ──────────────────────────────────────────────
-- A commission changing is the only event that can move a score, so
-- recalculate there rather than on a schedule alone.
CREATE OR REPLACE FUNCTION public.on_commission_change_refresh_score()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_covo_score(COALESCE(NEW.creator_id, OLD.creator_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS refresh_score_on_commission ON public.commissions;
CREATE TRIGGER refresh_score_on_commission
  AFTER INSERT OR UPDATE OF status ON public.commissions
  FOR EACH ROW EXECUTE FUNCTION public.on_commission_change_refresh_score();

-- Nightly sweep at 03:00 UTC picks up click-only movement, which has no
-- commission row to trigger on.
DO $$
BEGIN
  PERFORM cron.unschedule('covo-refresh-scores');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
  'covo-refresh-scores',
  '0 3 * * *',
  $$SELECT public.refresh_all_covo_scores()$$
);
