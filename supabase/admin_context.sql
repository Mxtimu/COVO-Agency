-- ════════════════════════════════════════════════════════════════════
-- COVO — admin gates that also work from the SQL Editor
--
-- Every admin-gated RPC checked is_admin(), which reads auth.uid() from
-- the request's JWT. The SQL Editor has no JWT: auth.uid() is NULL there,
-- is_admin() returns false, and the function refuses. So
-- abandon_payout() — written specifically to be run by hand when a
-- payout is stuck — could not be run by hand:
--
--   ERROR: Only an administrator may abandon a payout
--
-- The gate was asking the wrong question. "Is there an admin JWT on this
-- request?" is the right test for a browser and the wrong one for the
-- database owner, who is more privileged than any admin, not less.
--
-- can_act_as_admin() asks whether the caller is an admin OR is not a
-- browser at all. current_user is 'authenticated' or 'anon' only for a
-- request that came through PostgREST; the SQL Editor runs as postgres
-- and an Edge Function as service_role, both of which already bypass RLS
-- entirely. Admitting them here grants nothing they did not have.
--
-- is_admin() itself is deliberately untouched. It is load-bearing in RLS
-- policies, and those must keep answering strictly about the JWT.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.can_act_as_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
  SELECT public.is_admin() OR NOT public.is_direct_client_write();
$fn$;

REVOKE EXECUTE ON FUNCTION public.can_act_as_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_act_as_admin() TO authenticated, service_role;


-- ── Re-gate the functions meant to be operable by hand ───────────────
-- Only the gate line changes in each; the bodies are unchanged from the
-- files that created them.

CREATE OR REPLACE FUNCTION public.abandon_payout(p_payout_id UUID, p_reason TEXT)
RETURNS TABLE (abandoned BOOLEAN, outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _id UUID;
BEGIN
  IF NOT public.can_act_as_admin() THEN
    RAISE EXCEPTION 'Only an administrator may abandon a payout'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.payouts p
  SET status = 'failed',
      processed_at = NOW()
  WHERE p.id = p_payout_id
    AND p.status IN ('pending', 'processing')
  RETURNING p.id INTO _id;

  IF _id IS NULL THEN
    RETURN QUERY SELECT false, 'That payout is not pending or processing.'::TEXT;
    RETURN;
  END IF;

  -- 'failed' is not in the exclusion list, so the commissions become
  -- claimable again without touching them directly.
  RETURN QUERY SELECT true, NULL::TEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.abandon_payout(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.abandon_payout(UUID, TEXT) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.purge_test_paystack_data()
RETURNS TABLE (tranches_removed INT, payouts_removed INT, escrows_rebalanced INT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _tranches INT := 0;
  _payouts  INT := 0;
  _escrows  INT := 0;
BEGIN
  IF NOT public.can_act_as_admin() THEN
    RAISE EXCEPTION 'Only an administrator may purge test payment data'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH gone AS (
    DELETE FROM public.escrow_tranches WHERE livemode = false RETURNING id
  )
  SELECT COUNT(*) INTO _tranches FROM gone;

  WITH gone AS (
    DELETE FROM public.payouts WHERE livemode = false RETURNING id
  )
  SELECT COUNT(*) INTO _payouts FROM gone;

  WITH rebuilt AS (
    UPDATE public.campaign_escrow e
    SET total_deposited = COALESCE(d.deposited, 0),
        balance         = COALESCE(d.deposited, 0) - e.total_paid_out
    FROM (
      SELECT ce.id AS escrow_id,
             (SELECT COALESCE(SUM(t.amount), 0)
              FROM public.escrow_tranches t
              WHERE t.escrow_id = ce.id AND t.paystack_status = 'success') AS deposited
      FROM public.campaign_escrow ce
    ) d
    WHERE e.id = d.escrow_id
    RETURNING e.id
  )
  SELECT COUNT(*) INTO _escrows FROM rebuilt;

  RETURN QUERY SELECT _tranches, _payouts, _escrows;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.purge_test_paystack_data() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.purge_test_paystack_data() TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.paystack_test_money()
RETURNS TABLE (
  campaign_id     UUID,
  campaign_title  TEXT,
  test_deposits   NUMERIC,
  tranche_count   INT,
  current_balance NUMERIC
)
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
  SELECT c.id, c.title,
         COALESCE(SUM(t.amount), 0)::NUMERIC,
         COUNT(t.id)::INT,
         MAX(e.balance)
  FROM public.escrow_tranches t
  JOIN public.campaigns c       ON c.id = t.campaign_id
  JOIN public.campaign_escrow e ON e.campaign_id = c.id
  WHERE t.livemode = false
    AND t.paystack_status = 'success'
    AND public.can_act_as_admin()
  GROUP BY c.id, c.title;
$fn$;

REVOKE EXECUTE ON FUNCTION public.paystack_test_money() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.paystack_test_money() TO authenticated, service_role;


-- admin_create_payout stays on is_admin() deliberately. It writes
-- initiated_by = auth.uid(), so a run with no JWT would record a payout
-- nobody initiated — and unlike the functions above, it is not something
-- anyone needs to do by hand.


-- ── Verify ───────────────────────────────────────────────────────────
DO $do$
BEGIN
  IF public.can_act_as_admin() THEN
    RAISE NOTICE 'can_act_as_admin(): true here — abandon_payout and the purge are now runnable from this editor.';
  ELSE
    RAISE WARNING 'can_act_as_admin(): false. Unexpected in the SQL Editor — current_user is %', current_user;
  END IF;
END;
$do$;
 