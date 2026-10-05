-- ════════════════════════════════════════════════════════════════════
-- COVO — paying creators out
--
-- Money in is nearly done; money out does not exist. A creator with
-- R496.80 confirmed today sees "Withdrawals opening soon" and there is no
-- code path that could pay them. This is the other half.
--
-- Paystack pays a *recipient*, not an account number: bank details are
-- exchanged once for a recipient_code, and every transfer afterwards
-- references that code. So COVO does not need to keep the account number
-- to pay anyone — only the code.
--
-- It therefore does not keep it. bank_account_number already exists on
-- creator_profiles from an earlier schema and nothing has ever written to
-- it; this file drops it. Storing a creator's full bank account number
-- would mean a database breach hands out the account numbers of every
-- creator on the platform, to buy exactly nothing — the transfer works
-- from the recipient code either way. What is kept is the last four
-- digits, which is enough for a creator to recognise which account they
-- registered, and useless to anyone else.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS bank_code          TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_last4 TEXT,
  ADD COLUMN IF NOT EXISTS recipient_created_at TIMESTAMPTZ;

-- Never written, and a liability if it ever were. The recipient code is
-- what pays people.
ALTER TABLE public.creator_profiles DROP COLUMN IF EXISTS bank_account_number;

ALTER TABLE public.creator_profiles DROP CONSTRAINT IF EXISTS creator_profiles_last4_check;
ALTER TABLE public.creator_profiles ADD  CONSTRAINT creator_profiles_last4_check
  CHECK (bank_account_last4 IS NULL OR bank_account_last4 ~ '^[0-9]{4}$');


-- ── Recording a Paystack recipient ───────────────────────────────────
-- Called by the paystack-create-recipient Edge Function after Paystack
-- has accepted the bank details. Not callable from a browser: the
-- recipient code is what authorises money leaving, and
-- guard_creator_profile_privileges already refuses a client write to it.
CREATE OR REPLACE FUNCTION public.set_payout_recipient(
  p_creator        UUID,
  p_recipient_code TEXT,
  p_bank_code      TEXT,
  p_bank_name      TEXT,
  p_account_name   TEXT,
  p_last4          TEXT
)
RETURNS TABLE (updated BOOLEAN, outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF p_recipient_code IS NULL OR p_recipient_code = '' THEN
    RAISE EXCEPTION 'A recipient code is required';
  END IF;
  IF p_last4 !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'last4 must be exactly four digits, got %', p_last4;
  END IF;

  UPDATE public.creator_profiles cp
  SET paystack_recipient_code = p_recipient_code,
      bank_code               = p_bank_code,
      bank_name               = p_bank_name,
      bank_account_name       = p_account_name,
      bank_account_last4      = p_last4,
      recipient_created_at    = NOW()
  WHERE cp.id = p_creator;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'No creator profile for that id';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.set_payout_recipient(UUID, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_payout_recipient(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;


-- ── Claiming a payout for transfer ───────────────────────────────────
-- Moves a pending payout to 'processing' and records the Paystack
-- transfer code, in one statement so two admins clicking at the same
-- moment cannot both initiate a transfer for the same payout. The status
-- filter is the lock: the second claim matches nothing.
CREATE OR REPLACE FUNCTION public.claim_payout_for_transfer(
  p_payout_id     UUID,
  p_transfer_code TEXT,
  p_reference     TEXT
)
RETURNS TABLE (claimed BOOLEAN, outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _id UUID;
BEGIN
  UPDATE public.payouts p
  SET status                 = 'processing',
      paystack_transfer_code = p_transfer_code,
      paystack_reference     = p_reference
  WHERE p.id = p_payout_id
    AND p.status = 'pending'
  RETURNING p.id INTO _id;

  IF _id IS NULL THEN
    RETURN QUERY SELECT false, 'Payout is not pending — already claimed, or does not exist';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.claim_payout_for_transfer(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_payout_for_transfer(UUID, TEXT, TEXT) TO service_role;


-- ── Releasing a claim when Paystack refuses the transfer ─────────────
-- If the API call fails after the payout was claimed, it would otherwise
-- sit in 'processing' forever: no transfer exists, so no webhook will
-- ever settle it, and request_creator_payout() treats processing as
-- money already spoken for. The creator's earnings would be frozen with
-- nothing moving them.
CREATE OR REPLACE FUNCTION public.release_payout_claim(p_payout_id UUID, p_reason TEXT)
RETURNS TABLE (released BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _id UUID;
BEGIN
  UPDATE public.payouts p
  SET status                 = 'pending',
      paystack_transfer_code = NULL,
      paystack_reference     = NULL
  WHERE p.id = p_payout_id
    AND p.status = 'processing'
  RETURNING p.id INTO _id;

  RETURN QUERY SELECT (_id IS NOT NULL);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.release_payout_claim(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_payout_claim(UUID, TEXT) TO service_role;


-- ── payout_readiness lives in creator_identity.sql ───────────────────
-- It used to be defined here too, with six output columns, an is_admin()
-- gate and its own hardcoded R250. creator_identity.sql then DROPs and
-- recreates it with nine columns, so this copy never survived a full run
-- — it was only ever reachable by running this file again afterwards,
-- which would have quietly restored the R250 and a gate that throws for
-- pg_cron.
--
-- That is exactly how abandon_payout ended up with two bodies and a run
-- order that reinstated the broken one. One definition, one file.
