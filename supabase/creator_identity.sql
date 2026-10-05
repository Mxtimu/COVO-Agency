-- ════════════════════════════════════════════════════════════════════
-- COVO — the name on the bank account
--
-- Signup collects a display name: whatever someone typed, or whatever
-- their Google account is called. That is the right name to greet them
-- with and the wrong one to pay.
--
-- Paystack pays a recipient whose account holder name the bank checks.
-- A transfer to "Sipho M" against an account registered to
-- "Sipho Mahlangu" is a failed payout and a support conversation, and it
-- fails at the worst possible moment — after the creator has earned the
-- money and watched it clear.
--
-- So this collects a legal name and a phone number, and nothing else.
-- Deliberately not an ID number, not a date of birth, not an address:
-- COVO is not doing identity verification, and holding the documents
-- that would imply it means protecting them and answering for them.
-- Under POPIA the safest personal information is the kind you never
-- collected. What is here earns its place by making a payout work.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS legal_first_name TEXT,
  ADD COLUMN IF NOT EXISTS legal_last_name  TEXT,
  ADD COLUMN IF NOT EXISTS phone            TEXT;

-- Loose on purpose. South African mobiles are typed as 082…, 27 82…,
-- +27 82… and with every spacing in between, and a creator being told
-- their own phone number is wrong is a worse outcome than storing a
-- format we did not expect.
ALTER TABLE public.creator_profiles DROP CONSTRAINT IF EXISTS creator_profiles_phone_check;
ALTER TABLE public.creator_profiles ADD  CONSTRAINT creator_profiles_phone_check
  CHECK (phone IS NULL OR LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) BETWEEN 9 AND 15);


-- ── Does the legal name match the bank account? ──────────────────────
-- Compared loosely: case, punctuation and extra spacing are noise, and
-- middle names are normal on a bank account and rare in a signup form.
-- The test is whether every part of the legal name appears in the
-- account holder name, not whether the two strings are identical.
--
-- Returns NULL when either side is missing — "we cannot tell yet" is a
-- different answer from "these disagree", and the UI says so.
CREATE OR REPLACE FUNCTION public.payout_name_matches(p_creator UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
DECLARE
  _legal   TEXT;
  _account TEXT;
  _part    TEXT;
BEGIN
  SELECT LOWER(REGEXP_REPLACE(
           COALESCE(cp.legal_first_name, '') || ' ' || COALESCE(cp.legal_last_name, ''),
           '[^a-zA-Z ]', '', 'g')),
         LOWER(REGEXP_REPLACE(COALESCE(cp.bank_account_name, ''), '[^a-zA-Z ]', '', 'g'))
    INTO _legal, _account
  FROM public.creator_profiles cp
  WHERE cp.id = p_creator;

  IF _legal IS NULL OR TRIM(_legal) = '' OR _account IS NULL OR TRIM(_account) = '' THEN
    RETURN NULL;
  END IF;

  FOREACH _part IN ARRAY REGEXP_SPLIT_TO_ARRAY(TRIM(_legal), '\s+') LOOP
    -- Single initials are not evidence either way, so they are skipped
    -- rather than counted as a mismatch.
    CONTINUE WHEN LENGTH(_part) < 2;
    IF POSITION(_part IN _account) = 0 THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.payout_name_matches(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.payout_name_matches(UUID) TO authenticated, service_role;


-- ── payout_readiness gains the identity picture ──────────────────────
-- Dropped first: CREATE OR REPLACE cannot add output columns.
DROP FUNCTION IF EXISTS public.payout_readiness(UUID);

CREATE OR REPLACE FUNCTION public.payout_readiness(p_creator UUID)
RETURNS TABLE (
  has_recipient   BOOLEAN,
  bank_name       TEXT,
  account_name    TEXT,
  account_last4   TEXT,
  confirmed_total NUMERIC,
  meets_minimum   BOOLEAN,
  has_legal_name  BOOLEAN,
  has_phone       BOOLEAN,
  name_matches    BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
BEGIN
  -- can_act_as_admin(), not is_admin(): the monthly payout batch calls
  -- this for every creator, and it runs from pg_cron with no JWT at all.
  -- Under is_admin() that read raised 'Not authorised to view this' and
  -- took the whole batch down with it — the same wrong question
  -- admin_context.sql was written to fix, asked again here because this
  -- function was added afterwards. current_user is 'authenticated' only
  -- for a request that came through PostgREST, so a browser is still
  -- held to the JWT.
  IF NOT (p_creator = auth.uid() OR public.can_act_as_admin()) THEN
    RAISE EXCEPTION 'Not authorised to view this'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT (cp.paystack_recipient_code IS NOT NULL),
         cp.bank_name,
         cp.bank_account_name,
         cp.bank_account_last4,
         COALESCE(t.total, 0),
         COALESCE(t.total, 0) >= public.min_payout(),
         (COALESCE(TRIM(cp.legal_first_name), '') <> ''
          AND COALESCE(TRIM(cp.legal_last_name), '') <> ''),
         COALESCE(TRIM(cp.phone), '') <> '',
         public.payout_name_matches(p_creator)
  FROM public.creator_profiles cp
  LEFT JOIN LATERAL (
    SELECT SUM(c.net_commission) AS total
    FROM public.commissions c
    WHERE c.creator_id = p_creator AND c.status = 'confirmed'
  ) t ON true
  WHERE cp.id = p_creator;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.payout_readiness(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.payout_readiness(UUID) TO authenticated, service_role;


-- ── Who is missing what ──────────────────────────────────────────────
DO $do$
DECLARE
  _total INT;
  _named INT;
  _phone INT;
BEGIN
  SELECT COUNT(*) INTO _total FROM public.creator_profiles;
  SELECT COUNT(*) INTO _named FROM public.creator_profiles
   WHERE COALESCE(TRIM(legal_first_name), '') <> '' AND COALESCE(TRIM(legal_last_name), '') <> '';
  SELECT COUNT(*) INTO _phone FROM public.creator_profiles
   WHERE COALESCE(TRIM(phone), '') <> '';

  RAISE NOTICE 'creator_profiles: % total, % with a legal name, % with a phone number.',
    _total, _named, _phone;
  IF _total > _named THEN
    RAISE NOTICE 'The rest are prompted on their profile — nothing is blocked, but a payout to a mismatched name fails at the bank.';
  END IF;
END;
$do$;
