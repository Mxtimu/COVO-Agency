-- ════════════════════════════════════════════════════════════════════
-- COVO — keep test-mode Paystack money out of the real books
--
-- Paystack test mode is not a sandbox in the sense that matters here. It
-- sends genuine webhooks, signed with a genuine HMAC, to the same
-- endpoint — the only difference is that no money moved. So the moment a
-- test key is configured, a test payment produces an event this platform
-- cannot distinguish from a real one by signature, and
-- apply_paystack_deposit credits a real campaign's escrow with money that
-- does not exist.
--
-- That escrow balance is what decides whether a creator's commission is
-- payable or held, so fake funding would let COVO promise creators money
-- no brand has paid. It has to be tracked.
--
-- Two things stop that:
--
--   1. every tranche and payout records which mode produced it, so test
--      money is always identifiable rather than indistinguishable;
--   2. the Edge Function derives the expected mode from the secret key's
--      own prefix and refuses any event that disagrees — which is what
--      catches the dangerous direction, a test event arriving at a
--      live-keyed endpoint.
--
-- purge_test_paystack_data() then clears the test money and recomputes
-- balances from what is left, to be run once before going live.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.escrow_tranches
  ADD COLUMN IF NOT EXISTS livemode BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS livemode BOOLEAN NOT NULL DEFAULT true;

-- Defaults to true so anything already recorded is treated as real. A
-- wrong guess in that direction is visible and correctable; the reverse
-- would quietly delete real deposits on the first purge.

CREATE INDEX IF NOT EXISTS idx_tranches_testmode
  ON public.escrow_tranches (livemode) WHERE livemode = false;


-- ── Deposit, now mode-aware ──────────────────────────────────────────
-- Same signature plus p_livemode. Dropped first: CREATE OR REPLACE
-- cannot add a parameter to an existing function.
DROP FUNCTION IF EXISTS public.apply_paystack_deposit(TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.apply_paystack_deposit(
  p_reference TEXT,
  p_amount    NUMERIC,
  p_livemode  BOOLEAN DEFAULT true
)
RETURNS TABLE (
  deposit_applied  BOOLEAN,
  outcome          TEXT,
  escrow_after     NUMERIC,
  released         INT,
  campaign_resumed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _tranche  RECORD;
  _escrow   RECORD;
  _rel      RECORD;
  _resumed  BOOLEAN := false;
  _floor    NUMERIC := 500;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Deposit amount must be positive, got %', p_amount;
  END IF;

  -- Claim the tranche. The status filter is the idempotency guard:
  -- Paystack redelivers until it sees a 200 and will redeliver after a
  -- timeout even on success, so a second delivery must match nothing.
  UPDATE public.escrow_tranches t
  SET paystack_status = 'success',
      deposited_at    = NOW(),
      livemode        = p_livemode
  WHERE t.paystack_reference = p_reference
    AND t.paystack_status    = 'pending'
  RETURNING t.escrow_id, t.campaign_id, t.amount INTO _tranche;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'No pending tranche for that reference', NULL::NUMERIC, 0, false;
    RETURN;
  END IF;

  UPDATE public.campaign_escrow e
  SET balance         = e.balance + p_amount,
      total_deposited = e.total_deposited + p_amount
  WHERE e.id = _tranche.escrow_id
  RETURNING e.id, e.balance, e.status, e.campaign_id INTO _escrow;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tranche % points at escrow % which does not exist',
      p_reference, _tranche.escrow_id;
  END IF;

  SELECT * INTO _rel FROM public.release_held_commissions(_escrow.campaign_id);

  SELECT e.balance, e.status INTO _escrow
  FROM public.campaign_escrow e WHERE e.id = _tranche.escrow_id;

  IF _escrow.status = 'paused' AND _escrow.balance >= _floor THEN
    UPDATE public.campaign_escrow SET status = 'active' WHERE id = _tranche.escrow_id;
    UPDATE public.campaigns       SET status = 'active' WHERE id = _tranche.campaign_id;
    _resumed := true;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT, _escrow.balance,
                      COALESCE(_rel.released_count, 0), _resumed;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.apply_paystack_deposit(TEXT, NUMERIC, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_paystack_deposit(TEXT, NUMERIC, BOOLEAN) TO service_role;


-- ── What test money is currently in the books ────────────────────────
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
    AND public.is_admin()
  GROUP BY c.id, c.title;
$fn$;

REVOKE EXECUTE ON FUNCTION public.paystack_test_money() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.paystack_test_money() TO authenticated, service_role;


-- ── Clear test money before going live ───────────────────────────────
-- Deliberately not automatic and deliberately admin-only. Balances are
-- recomputed from the surviving live tranches rather than decremented,
-- so the result does not depend on the arithmetic having been right the
-- first time.
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
  IF NOT public.is_admin() THEN
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

  -- Rebuild every escrow balance from its remaining successful deposits
  -- minus what has actually been paid out.
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
