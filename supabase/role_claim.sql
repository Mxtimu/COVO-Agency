-- ════════════════════════════════════════════════════════════════════
-- COVO — letting a social sign-up say which kind of account it is
--
-- A brand could not sign up with Google or Facebook. Not "it was
-- awkward" — it was impossible, and it failed silently.
--
-- handle_new_user() takes the role from
-- raw_user_meta_data->>'user_type', which the signup forms put there.
-- OAuth never does: Supabase fills that column from the provider, which
-- sends a name, an email and an avatar and knows nothing about COVO.
-- So the COALESCE fell through to 'creator' for every social sign-up.
--
-- Then guard_profile_privileges() refuses any role change from a
-- browser, which is correct and must stay that way — it is what stops a
-- creator making themselves an admin. The two together meant a brand who
-- clicked "Continue with Google" became a creator permanently, was sent
-- to creator onboarding, and had no way back. The role picker on /auth
-- was collecting the answer and throwing it away.
--
-- WHY A CLAIM RATHER THAN PASSING THE ROLE THROUGH OAUTH
--
--   The role could be smuggled into the OAuth state and read by the
--   trigger, but then the role would come from a value the browser
--   supplied during signup — the exact shape of the bug this schema
--   already has a guard against. A claim keeps the browser out of it:
--   the account is created as a creator either way, and changing it is
--   a separate, audited, once-only act with its own rules.
--
-- WHY IT IS SAFE
--
--   Only the account's owner can call it, only while the account has
--   done nothing at all, only once, and never to 'admin'. Nothing is
--   migrated because there is nothing to migrate — that is the whole
--   precondition. An account with a single commission, campaign or
--   payout against it is refused, so there is no path where money or
--   history changes hands with the role.
--
--   SECURITY DEFINER is what lets it past the guard: inside the
--   function current_user is the owner, so is_direct_client_write() is
--   false and the trigger waves it through. The guard still blocks a
--   plain update({role}) from the browser, which is the point — this
--   function becomes the only door, and it is a narrow one.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role_claimed_at TIMESTAMPTZ;

-- ── Has this account done anything yet? ──────────────────────────────
-- Split out so the claim and the UI ask the same question. If this is
-- true the role is settled and stays settled.
CREATE OR REPLACE FUNCTION public.account_has_activity(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
  SELECT
       EXISTS (SELECT 1 FROM public.campaigns              WHERE brand_id   = p_user)
    OR EXISTS (SELECT 1 FROM public.campaign_escrow        WHERE brand_id   = p_user)
    OR EXISTS (SELECT 1 FROM public.affiliate_links        WHERE creator_id = p_user)
    OR EXISTS (SELECT 1 FROM public.commissions            WHERE creator_id = p_user)
    OR EXISTS (SELECT 1 FROM public.payouts                WHERE creator_id = p_user)
    OR EXISTS (SELECT 1 FROM public.campaign_applications  WHERE creator_id = p_user)
    -- Finished onboarding counts as activity: they have told COVO who
    -- they are as that kind of account, and a brand with a company name
    -- on file is not an unsettled signup.
    OR EXISTS (SELECT 1 FROM public.brand_profiles
                WHERE id = p_user
                  AND (onboarding_complete OR COALESCE(TRIM(company_name), '') <> ''))
    OR EXISTS (SELECT 1 FROM public.creator_profiles
                WHERE id = p_user AND guardrail_acknowledged);
$fn$;

REVOKE EXECUTE ON FUNCTION public.account_has_activity(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.account_has_activity(UUID) TO authenticated, service_role;


-- ── Backfill, deliberately partial ───────────────────────────────────
-- Only accounts that have DONE something are marked claimed. The first
-- version of this marked every existing row, which would have locked in
-- the bug it is meant to fix: the accounts that are stuck as creators
-- are precisely the empty social sign-ups, and claiming them on their
-- behalf would have left them stuck forever with no path out.
--
-- So an established account's role is frozen, and an empty one is still
-- free to be settled — which is the same rule the claim applies from
-- here on, just applied once to the accounts that predate it.
UPDATE public.profiles p
SET role_claimed_at = COALESCE(p.role_claimed_at, p.created_at, NOW())
WHERE p.role_claimed_at IS NULL
  AND (p.role = 'admin' OR public.account_has_activity(p.id));


-- ── May I still choose? ──────────────────────────────────────────────
-- So the UI can show the picker only when it would work, rather than
-- offering a choice that fails on submit.
CREATE OR REPLACE FUNCTION public.my_role_claim_status()
RETURNS TABLE (role TEXT, claimable BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
DECLARE
  _p RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT NULL::TEXT, false, 'Not signed in.'::TEXT;
    RETURN;
  END IF;

  SELECT p.role, p.role_claimed_at INTO _p
  FROM public.profiles p WHERE p.id = auth.uid();

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::TEXT, false, 'No profile yet.'::TEXT;
    RETURN;
  END IF;

  IF _p.role = 'admin' THEN
    RETURN QUERY SELECT _p.role, false, 'Administrator accounts cannot be changed here.'::TEXT;
    RETURN;
  END IF;

  IF _p.role_claimed_at IS NOT NULL THEN
    RETURN QUERY SELECT _p.role, false, 'Your account type is already set.'::TEXT;
    RETURN;
  END IF;

  IF public.account_has_activity(auth.uid()) THEN
    RETURN QUERY SELECT _p.role, false,
      'This account has activity on it, so its type is fixed. Contact support if it is wrong.'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT _p.role, true, NULL::TEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.my_role_claim_status() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_role_claim_status() TO authenticated, service_role;


-- ── The claim ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_account_role(p_role TEXT)
RETURNS TABLE (claimed BOOLEAN, role TEXT, outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _uid  UUID := auth.uid();
  _p    RECORD;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to set your account type'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 'admin' is not in this list and never will be. Role escalation is
  -- the thing security_hardening.sql exists to prevent, and a function
  -- that can grant a role is exactly where it would come back.
  IF p_role IS NULL OR p_role NOT IN ('creator', 'brand') THEN
    RAISE EXCEPTION 'An account is either a creator or a brand'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT p.role, p.role_claimed_at INTO _p
  FROM public.profiles p WHERE p.id = _uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::TEXT, 'No profile for this account yet.'::TEXT;
    RETURN;
  END IF;

  IF _p.role = 'admin' THEN
    RETURN QUERY SELECT false, _p.role, 'Administrator accounts cannot be changed here.'::TEXT;
    RETURN;
  END IF;

  -- Already what was asked for: report success without writing. The
  -- caller is the OAuth callback, which cannot easily know whether it
  -- needs to act, so asking twice must be harmless.
  IF _p.role = p_role THEN
    UPDATE public.profiles
    SET role_claimed_at = COALESCE(role_claimed_at, NOW())
    WHERE id = _uid;
    RETURN QUERY SELECT true, p_role, NULL::TEXT;
    RETURN;
  END IF;

  IF _p.role_claimed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, _p.role,
      'Your account type is already set. Contact support if it is wrong.'::TEXT;
    RETURN;
  END IF;

  IF public.account_has_activity(_uid) THEN
    RETURN QUERY SELECT false, _p.role,
      'This account already has activity on it, so its type cannot be changed.'::TEXT;
    RETURN;
  END IF;

  UPDATE public.profiles
  SET role = p_role, role_claimed_at = NOW()
  WHERE id = _uid;

  -- The unused side's row, if onboarding happened to create an empty
  -- one, is deliberately left alone: it holds nothing, routing is
  -- decided by profiles.role, and deleting rows across a cascade to
  -- tidy up is a worse trade than an empty row nobody reads.

  RETURN QUERY SELECT true, p_role, NULL::TEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.claim_account_role(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.claim_account_role(TEXT) TO authenticated;


-- ── Verify ───────────────────────────────────────────────────────────
DO $do$
DECLARE
  _unclaimed INT;
  _guard     TEXT;
BEGIN
  SELECT COUNT(*) INTO _unclaimed FROM public.profiles WHERE role_claimed_at IS NULL;

  -- The guard must still be INVOKER, or it reads current_user as its own
  -- owner on every write and stops guarding anything.
  SELECT CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END INTO _guard
  FROM pg_proc p
  WHERE p.proname = 'guard_profile_privileges'
    AND p.pronamespace = 'public'::regnamespace;

  -- Not zero, and should not be: these are the empty accounts that can
  -- still choose, including any brand currently stuck as a creator.
  RAISE NOTICE '% empty account(s) can still choose their type; everything with activity on it is frozen.', _unclaimed;

  IF _guard = 'INVOKER' THEN
    RAISE NOTICE 'guard_profile_privileges is SECURITY INVOKER — a browser still cannot change a role directly.';
  ELSE
    RAISE WARNING 'guard_profile_privileges is %, expected INVOKER. Re-run security_hardening.sql.', _guard;
  END IF;
END;
$do$;
