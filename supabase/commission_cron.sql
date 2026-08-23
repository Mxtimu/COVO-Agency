-- ════════════════════════════════════════════════════════════════════
-- COVO — automatic commission confirmation
--
-- A commission is created 'pending' with confirms_at = sale + the
-- campaign's return window. Once that window closes with no return, the
-- creator has earned it. Nothing was flipping that switch, so every
-- commission sat pending forever and no creator could ever be paid.
--
-- The work is pure SQL, so it runs inside the database on a schedule
-- rather than over HTTP: one transaction, no network, no auth surface,
-- no cold start.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.confirm_due_commissions()
RETURNS TABLE (confirmed_count INT, total_value NUMERIC, campaigns_paused INT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _confirmed INT := 0;
  _total     NUMERIC := 0;
  _paused    INT := 0;
BEGIN
  -- Claim everything whose return window has closed. The status filter is
  -- what makes this safe to run concurrently: a second invocation finds
  -- nothing left to claim.
  CREATE TEMP TABLE _newly_confirmed ON COMMIT DROP AS
  WITH claimed AS (
    UPDATE public.commissions
    SET status = 'confirmed'
    WHERE status = 'pending'
      AND confirms_at IS NOT NULL
      AND confirms_at <= NOW()
    RETURNING id, campaign_id, net_commission
  )
  SELECT * FROM claimed;

  SELECT COUNT(*), COALESCE(SUM(net_commission), 0)
    INTO _confirmed, _total
  FROM _newly_confirmed;

  -- Draw the confirmed amounts down from each campaign's escrow, one
  -- statement per campaign rather than per commission.
  UPDATE public.campaign_escrow ce
  SET balance        = ce.balance - agg.owed,
      total_paid_out = ce.total_paid_out + agg.owed
  FROM (
    SELECT campaign_id, SUM(net_commission) AS owed
    FROM _newly_confirmed GROUP BY campaign_id
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
      AND campaign_id IN (SELECT DISTINCT campaign_id FROM _newly_confirmed)
    RETURNING campaign_id
  )
  SELECT COUNT(*) INTO _paused FROM paused;

  UPDATE public.campaigns SET status = 'paused'
  WHERE status = 'active'
    AND id IN (SELECT campaign_id FROM public.campaign_escrow WHERE status = 'paused');

  RETURN QUERY SELECT _confirmed, _total, _paused;
END;
$$;

-- Money movement: service_role and the scheduler only, never a browser.
REVOKE EXECUTE ON FUNCTION public.confirm_due_commissions() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_due_commissions() TO service_role;

-- ── Schedule: 02:00 UTC daily (04:00 SAST) ───────────────────────────
-- Unschedule first so re-running this file does not stack duplicate jobs.
DO $$
BEGIN
  PERFORM cron.unschedule('covo-confirm-commissions');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- no such job yet
END;
$$;

SELECT cron.schedule(
  'covo-confirm-commissions',
  '0 2 * * *',
  $$SELECT public.confirm_due_commissions()$$
);
