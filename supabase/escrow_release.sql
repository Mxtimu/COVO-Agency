-- ════════════════════════════════════════════════════════════════════
-- COVO — held commissions and escrow solvency
--
-- Two gaps in the money lifecycle, which are really one gap seen twice.
--
-- 1. 'held' was a terminal state. record-conversion writes it when a
--    campaign's escrow cannot cover a sale, on the reasoning that the
--    creator did the work and should not be punished for the brand's
--    shortfall. But nothing anywhere moved a commission back out of
--    'held' — confirm_due_commissions() only ever claimed 'pending', and
--    the Paystack webhook resumed the campaign without looking at the
--    commissions the shortfall had stranded. Funding the campaign
--    afterwards did not pay the creator. It could not.
--
-- 2. confirm_due_commissions() subtracted from escrow unconditionally,
--    so the balance could go negative, and a campaign with no escrow row
--    at all confirmed its commissions against nothing — the UPDATE ... FROM
--    simply matched no rows and the drawdown was skipped in silence.
--    Either way COVO owed a creator money no brand had deposited.
--
-- Both are fixed by making solvency the thing that decides, in both
-- directions: escrow paying for it is what confirms a commission, and
-- escrow covering it is what releases a held one.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── Release held commissions once the brand funds the campaign ───────
-- Oldest first: if the deposit only partly covers the backlog, the
-- creator who has been waiting longest is paid first.
CREATE OR REPLACE FUNCTION public.release_held_commissions(p_campaign_id UUID DEFAULT NULL)
RETURNS TABLE (released_count INT, released_value NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _campaign  RECORD;
  _held      RECORD;
  _headroom  NUMERIC;
  _released  INT := 0;
  _value     NUMERIC := 0;
BEGIN
  FOR _campaign IN
    SELECT e.campaign_id,
           e.balance - COALESCE((
             SELECT SUM(c.net_commission)
             FROM public.commissions c
             WHERE c.campaign_id = e.campaign_id
               AND c.status IN ('pending', 'confirmed')
           ), 0) AS headroom
    FROM public.campaign_escrow e
    WHERE (p_campaign_id IS NULL OR e.campaign_id = p_campaign_id)
  LOOP
    _headroom := _campaign.headroom;
    CONTINUE WHEN _headroom IS NULL OR _headroom <= 0;

    -- Release the longest-waiting commissions that still fit under the
    -- uncommitted balance. confirms_at is deliberately left alone: the
    -- return window runs from the sale, not from when the brand got
    -- around to paying, so a long-held commission clears immediately.
    FOR _held IN
      SELECT id, net_commission
      FROM public.commissions
      WHERE campaign_id = _campaign.campaign_id
        AND status = 'held'
      ORDER BY created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN _held.net_commission > _headroom;

      UPDATE public.commissions
      SET status      = 'pending',
          confirms_at = COALESCE(confirms_at, NOW())
      WHERE id = _held.id;

      _headroom := _headroom - _held.net_commission;
      _released := _released + 1;
      _value    := _value + _held.net_commission;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT _released, _value;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.release_held_commissions(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_held_commissions(UUID) TO service_role;


-- ── Confirmation, now gated on the escrow actually paying ────────────
-- The return type gains held_back, so the old function is dropped rather
-- than replaced.
DROP FUNCTION IF EXISTS public.confirm_due_commissions();

CREATE FUNCTION public.confirm_due_commissions()
RETURNS TABLE (confirmed_count INT, total_value NUMERIC, campaigns_paused INT, held_back INT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _confirmed INT := 0;
  _total     NUMERIC := 0;
  _paused    INT := 0;
  _held      INT := 0;
BEGIN
  -- Everything whose return window has closed, paired with the balance
  -- standing behind it. A campaign with no escrow row gets 0, which is
  -- what it has always actually had.
  DROP TABLE IF EXISTS _due;
  CREATE TEMP TABLE _due ON COMMIT DROP AS
  SELECT c.id,
         c.campaign_id,
         c.net_commission,
         c.created_at,
         COALESCE(e.balance, 0) AS balance,
         SUM(c.net_commission) OVER (
           PARTITION BY c.campaign_id ORDER BY c.created_at, c.id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS running_total
  FROM public.commissions c
  LEFT JOIN public.campaign_escrow e ON e.campaign_id = c.campaign_id
  WHERE c.status = 'pending'
    AND c.confirms_at IS NOT NULL
    AND c.confirms_at <= NOW();

  -- Confirm the prefix each campaign's balance can actually pay for.
  -- The running total is what keeps this honest: ten commissions each
  -- individually under the balance must not all confirm against it.
  WITH claimed AS (
    UPDATE public.commissions c
    SET status = 'confirmed'
    FROM _due d
    WHERE c.id = d.id
      AND c.status = 'pending'
      AND d.running_total <= d.balance
    RETURNING c.id, c.campaign_id, c.net_commission
  )
  SELECT COUNT(*), COALESCE(SUM(net_commission), 0) INTO _confirmed, _total FROM claimed;

  -- The remainder goes back to 'held' rather than confirming against
  -- money that is not there. release_held_commissions() picks them up
  -- the moment the brand tops the campaign up.
  WITH stranded AS (
    UPDATE public.commissions c
    SET status = 'held'
    FROM _due d
    WHERE c.id = d.id
      AND c.status = 'pending'
      AND d.running_total > d.balance
    RETURNING c.id
  )
  SELECT COUNT(*) INTO _held FROM stranded;

  -- Draw the confirmed amounts down, one statement per campaign. The
  -- prefix rule above is what guarantees this cannot go negative.
  UPDATE public.campaign_escrow ce
  SET balance        = ce.balance - agg.owed,
      total_paid_out = ce.total_paid_out + agg.owed
  FROM (
    SELECT d.campaign_id, SUM(d.net_commission) AS owed
    FROM _due d
    WHERE d.running_total <= d.balance
    GROUP BY d.campaign_id
  ) agg
  WHERE ce.campaign_id = agg.campaign_id;

  -- Any campaign now under the R500 floor stops accruing new commission
  -- the brand has not funded.
  WITH paused AS (
    UPDATE public.campaign_escrow
    SET status = 'paused',
        low_balance_notified_at = COALESCE(low_balance_notified_at, NOW())
    WHERE status = 'active'
      AND balance < 500
      AND campaign_id IN (SELECT DISTINCT campaign_id FROM _due)
    RETURNING campaign_id
  )
  SELECT COUNT(*) INTO _paused FROM paused;

  UPDATE public.campaigns SET status = 'paused'
  WHERE status = 'active'
    AND id IN (SELECT campaign_id FROM public.campaign_escrow WHERE status = 'paused');

  RETURN QUERY SELECT _confirmed, _total, _paused, _held;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.confirm_due_commissions() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_due_commissions() TO service_role;


-- ── Nightly: release first, then confirm ─────────────────────────────
-- Order matters. Releasing first means a commission funded overnight can
-- confirm in the same run rather than waiting another full day.
CREATE OR REPLACE FUNCTION public.run_commission_cycle()
RETURNS TABLE (released INT, confirmed INT, total_value NUMERIC, paused INT, held INT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _rel RECORD;
  _con RECORD;
BEGIN
  SELECT * INTO _rel FROM public.release_held_commissions(NULL);
  SELECT * INTO _con FROM public.confirm_due_commissions();

  RETURN QUERY SELECT _rel.released_count, _con.confirmed_count,
                      _con.total_value, _con.campaigns_paused, _con.held_back;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.run_commission_cycle() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.run_commission_cycle() TO service_role;

DO $do$
BEGIN
  PERFORM cron.unschedule('covo-confirm-commissions');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- no such job yet
END;
$do$;

SELECT cron.schedule(
  'covo-confirm-commissions',
  '0 2 * * *',
  $job$SELECT public.run_commission_cycle()$job$
);
