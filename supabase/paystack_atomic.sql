-- ════════════════════════════════════════════════════════════════════
-- COVO — make the Paystack money paths atomic
--
-- The webhook did each money operation as a separate round trip and
-- checked none of them, then returned 200 regardless. Two consequences,
-- both of which lose real money without a trace:
--
-- DEPOSIT. The tranche was marked 'success' first, and the escrow
-- credited second. If the credit failed, the tranche was already claimed,
-- so the retry guard meant Paystack's redelivery matched nothing — and
-- the 200 told Paystack to stop retrying anyway. The brand had paid, the
-- balance never moved, and nothing anywhere recorded that.
--
-- PAYOUT. The payout row was marked 'success', then its commissions were
-- marked 'paid' in a second statement. If that second one failed, the
-- commissions stayed 'confirmed' — and request_creator_payout() excludes
-- only commissions inside a pending/processing/success payout, so the
-- creator could claim the same earnings again in the next batch. COVO
-- pays twice.
--
-- Both are fixed by doing the whole sequence in one function, so it is
-- one transaction. If any step raises, everything rolls back — including
-- the claim on the tranche — and Paystack's next delivery retries it
-- cleanly. The webhook's job is then only to report failure honestly, so
-- that retry actually happens.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── Deposit: claim, credit, release, resume — or none of it ──────────
CREATE OR REPLACE FUNCTION public.apply_paystack_deposit(
  p_reference TEXT,
  p_amount    NUMERIC
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
      deposited_at    = NOW()
  WHERE t.paystack_reference = p_reference
    AND t.paystack_status    = 'pending'
  RETURNING t.escrow_id, t.campaign_id, t.amount INTO _tranche;

  IF NOT FOUND THEN
    -- Either already applied, or no such reference. Both are a no-op the
    -- webhook should acknowledge rather than retry.
    RETURN QUERY SELECT false, 'No pending tranche for that reference', NULL::NUMERIC, 0, false;
    RETURN;
  END IF;

  -- Credit the escrow. Same transaction as the claim above, so a failure
  -- here un-claims the tranche too and the retry works.
  UPDATE public.campaign_escrow e
  SET balance         = e.balance + p_amount,
      total_deposited = e.total_deposited + p_amount
  WHERE e.id = _tranche.escrow_id
  RETURNING e.id, e.balance, e.status, e.campaign_id INTO _escrow;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tranche % points at escrow % which does not exist',
      p_reference, _tranche.escrow_id;
  END IF;

  -- Commissions earned while the campaign was underfunded were parked as
  -- 'held'. This deposit is what pays for them, so release what it covers
  -- before deciding whether the campaign can reopen.
  SELECT * INTO _rel FROM public.release_held_commissions(_escrow.campaign_id);

  -- Re-read: releasing may have committed more of the balance.
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

REVOKE EXECUTE ON FUNCTION public.apply_paystack_deposit(TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_paystack_deposit(TEXT, NUMERIC) TO service_role;


-- ── Payout settlement: status and commissions together ───────────────
CREATE OR REPLACE FUNCTION public.mark_payout_settled(
  p_reference TEXT,
  p_status    TEXT
)
RETURNS TABLE (
  payout_updated      BOOLEAN,
  outcome             TEXT,
  commissions_changed INT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _payout  RECORD;
  _changed INT := 0;
BEGIN
  IF p_status NOT IN ('success', 'failed', 'reversed') THEN
    RAISE EXCEPTION 'Unsupported payout status %', p_status;
  END IF;

  UPDATE public.payouts p
  SET status       = p_status,
      processed_at = CASE WHEN p_status = 'success' THEN NOW() ELSE p.processed_at END
  WHERE p.paystack_reference = p_reference
    AND p.status IS DISTINCT FROM p_status
  RETURNING p.id, p.commission_ids INTO _payout;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'No payout at that reference, or already in that state', 0;
    RETURN;
  END IF;

  IF _payout.commission_ids IS NULL OR ARRAY_LENGTH(_payout.commission_ids, 1) IS NULL THEN
    RETURN QUERY SELECT true, NULL::TEXT, 0;
    RETURN;
  END IF;

  IF p_status = 'success' THEN
    -- Only confirmed commissions become paid. Without the status filter a
    -- redelivered transfer.success could drag a commission that had since
    -- been disputed and denied back into 'paid'.
    WITH done AS (
      UPDATE public.commissions c
      SET status = 'paid'
      WHERE c.id = ANY(_payout.commission_ids)
        AND c.status = 'confirmed'
      RETURNING c.id
    )
    SELECT COUNT(*) INTO _changed FROM done;

  ELSIF p_status = 'reversed' THEN
    -- The transfer was undone, so the creator never received it. Put the
    -- commissions back to confirmed so they can be paid again. A 'failed'
    -- payout needs no such step: nothing was ever marked paid, and
    -- request_creator_payout() already ignores failed payouts when
    -- deciding what is still claimable.
    WITH back AS (
      UPDATE public.commissions c
      SET status = 'confirmed'
      WHERE c.id = ANY(_payout.commission_ids)
        AND c.status = 'paid'
      RETURNING c.id
    )
    SELECT COUNT(*) INTO _changed FROM back;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT, _changed;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.mark_payout_settled(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_payout_settled(TEXT, TEXT) TO service_role;
