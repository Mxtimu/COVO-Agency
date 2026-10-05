-- ════════════════════════════════════════════════════════════════════
-- COVO — an admin cannot pay the same earnings twice
--
-- AdminPayouts created payout rows with a raw insert: it summed a
-- creator's confirmed commissions in the browser and wrote that total,
-- with no check for what was already claimed. Clicking the button twice
-- therefore produced two payouts over the same commission ids, and two
-- real transfers left Paystack for the same money. Observed live on
-- 2026-09-16 — two transfers of R496.80 against one set of earnings,
-- which only failed to pay out twice because Paystack happened to be
-- holding both for OTP.
--
-- request_creator_payout() never had this problem: it excludes any
-- commission already inside a pending, processing or successful payout.
-- The admin path simply did not go through it.
--
-- So it goes through the same rule now, in the database, computed from
-- the commissions rather than accepted from the browser. The amount is
-- not a parameter here for the same reason it is not one there — a total
-- sent from a client is a total that can be wrong, whether by a stale
-- page or a forged request.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_create_payout(p_creator UUID)
RETURNS TABLE (
  payout_id        UUID,
  amount           NUMERIC,
  commission_count INT,
  outcome          TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _available NUMERIC;
  _ids       UUID[];
  _payout    UUID;
  _min       NUMERIC := public.min_payout();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator may create a payout'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Confirmed commissions not already spoken for. The NOT EXISTS is the
  -- whole point: a commission inside a pending, processing or successful
  -- payout is money already on its way, and must not be sent again.
  SELECT COALESCE(SUM(c.net_commission), 0), COALESCE(ARRAY_AGG(c.id), '{}')
    INTO _available, _ids
  FROM public.commissions c
  WHERE c.creator_id = p_creator
    AND c.status = 'confirmed'
    AND NOT EXISTS (
      SELECT 1 FROM public.payouts p
      WHERE p.creator_id = p_creator
        AND p.status IN ('pending', 'processing', 'success')
        AND c.id = ANY(p.commission_ids)
    );

  IF COALESCE(ARRAY_LENGTH(_ids, 1), 0) = 0 THEN
    RETURN QUERY SELECT NULL::UUID, 0::NUMERIC, 0,
      'Everything confirmed for this creator is already inside a payout.'::TEXT;
    RETURN;
  END IF;

  IF _available < _min THEN
    RETURN QUERY SELECT NULL::UUID, _available, COALESCE(ARRAY_LENGTH(_ids, 1), 0),
      format('Only R%s is unclaimed, which is under the R%s minimum.',
             ROUND(_available, 2), _min)::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.payouts (creator_id, amount, status, commission_ids, initiated_by)
  VALUES (p_creator, _available, 'pending', _ids, auth.uid())
  RETURNING id INTO _payout;

  RETURN QUERY SELECT _payout, _available, COALESCE(ARRAY_LENGTH(_ids, 1), 0), NULL::TEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.admin_create_payout(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_create_payout(UUID) TO authenticated, service_role;


-- ── Clearing a transfer that will never settle ───────────────────────
-- abandon_payout() used to be defined here as well as in
-- admin_context.sql, with a different gate in each. Two definitions of one
-- function is a race decided by whichever file ran last, and it duly went
-- wrong: admin_context.sql patched the gate to can_act_as_admin() so the
-- function could be run from the SQL Editor, and then this file redefined
-- it back to is_admin() a moment later, restoring the exact error the
-- patch existed to remove.
--
-- It now lives only in admin_context.sql. One definition, one place, no
-- dependence on run order.

-- ── What is stuck right now ──────────────────────────────────────────
DO $do$
DECLARE
  _stuck INT;
  _dupes INT;
BEGIN
  SELECT COUNT(*) INTO _stuck FROM public.payouts WHERE status IN ('pending','processing');

  -- Payouts sharing a commission with another payout — the double-pay shape.
  SELECT COUNT(*) INTO _dupes
  FROM public.payouts a
  JOIN public.payouts b
    ON a.id < b.id
   AND a.creator_id = b.creator_id
   AND a.commission_ids && b.commission_ids
  WHERE a.status IN ('pending','processing','success')
    AND b.status IN ('pending','processing','success');

  RAISE NOTICE 'payouts: % pending/processing', _stuck;
  IF _dupes > 0 THEN
    RAISE NOTICE 'payouts: %  PAIR(S) OVERLAP on the same commissions — that is the same money twice.', _dupes;
    RAISE NOTICE 'Review with:  SELECT id, amount, status, created_at FROM public.payouts WHERE status IN (''pending'',''processing'') ORDER BY created_at;';
    RAISE NOTICE 'Then clear the extras with:  SELECT * FROM public.abandon_payout(''<payout id>'', ''duplicate'');';
  ELSE
    RAISE NOTICE 'payouts: no overlapping claims.';
  END IF;
END;
$do$;
