-- ════════════════════════════════════════════════════════════════════
-- COVO — deleting an account without deleting the ledger
--
-- The obvious implementation is auth.admin.deleteUser(). It is also the
-- wrong one. profiles.id references auth.users ON DELETE CASCADE, and
-- commissions.creator_id references profiles ON DELETE CASCADE — so
-- deleting one creator would take every commission they ever earned with
-- them. Those rows are not only theirs: they are what a brand's escrow
-- was spent on, and what COVO's platform fee was charged against. One
-- person exercising a right to erasure would quietly rewrite somebody
-- else's accounts.
--
-- So the personal information goes and the financial record stays. Names,
-- email, phone, bank details and social handles are overwritten; the
-- commission rows keep pointing at a profile that no longer says who
-- anyone is. That is what POPIA's retention exemptions are for — the
-- obligation to keep financial records outlives the obligation to forget.
--
-- Deletion is refused outright while money is in flight. Erasing someone
-- who is owed R400 does not settle the debt, it just removes the person
-- COVO owes it to.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- 'deleted' was not an allowed status.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_status_check
  CHECK (status IN ('pending','approved','suspended','deleted'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;


-- ── What is stopping this account from being closed ──────────────────
-- Returns one row per blocker, so the UI can name them rather than say
-- "you cannot do that".
CREATE OR REPLACE FUNCTION public.account_deletion_blockers(p_user UUID)
RETURNS TABLE (blocker TEXT, detail TEXT, amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
BEGIN
  IF NOT (p_user = auth.uid() OR public.is_admin()) THEN
    RAISE EXCEPTION 'Not authorised' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Creator: earnings not yet paid out.
  RETURN QUERY
  SELECT 'unpaid_earnings',
         format('%s commission(s) worth R%s have not been paid out yet.',
                COUNT(*), ROUND(SUM(c.net_commission), 2)),
         ROUND(SUM(c.net_commission), 2)
  FROM public.commissions c
  WHERE c.creator_id = p_user
    AND c.status IN ('pending', 'confirmed', 'held')
  HAVING COUNT(*) > 0;

  -- Creator: a payout already on its way.
  RETURN QUERY
  SELECT 'payout_in_flight',
         format('A payout of R%s is still being processed.', ROUND(SUM(p.amount), 2)),
         ROUND(SUM(p.amount), 2)
  FROM public.payouts p
  WHERE p.creator_id = p_user
    AND p.status IN ('pending', 'processing')
  HAVING COUNT(*) > 0;

  -- Brand: money still sitting in escrow is theirs, and closing the
  -- account would strand it.
  RETURN QUERY
  SELECT 'escrow_balance',
         format('R%s is still held in escrow across %s campaign(s).',
                ROUND(SUM(e.balance), 2), COUNT(*)),
         ROUND(SUM(e.balance), 2)
  FROM public.campaign_escrow e
  WHERE e.brand_id = p_user AND e.balance > 0
  HAVING COUNT(*) > 0;

  -- Brand: creators are mid-campaign and owed against it.
  RETURN QUERY
  SELECT 'active_campaigns',
         format('%s campaign(s) are still live with creators promoting them.', COUNT(*)),
         NULL::NUMERIC
  FROM public.campaigns c
  WHERE c.brand_id = p_user AND c.status = 'active'
  HAVING COUNT(*) > 0;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.account_deletion_blockers(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.account_deletion_blockers(UUID) TO authenticated, service_role;


-- ── Erase the person, keep the accounting ────────────────────────────
-- Called by the delete-account Edge Function, which bans the auth user
-- afterwards. Not callable from a browser: it is irreversible, and the
-- blocker check has to happen first.
CREATE OR REPLACE FUNCTION public.anonymise_account(p_user UUID)
RETURNS TABLE (anonymised BOOLEAN, outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _blockers INT;
  _role     TEXT;
BEGIN
  SELECT COUNT(*) INTO _blockers
  FROM public.account_deletion_blockers(p_user);

  IF _blockers > 0 THEN
    RETURN QUERY SELECT false, 'Account still has money or campaigns in flight.';
    RETURN;
  END IF;

  SELECT role INTO _role FROM public.profiles WHERE id = p_user;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'No such account.';
    RETURN;
  END IF;

  -- A tombstone rather than NULL: the commission rows still join to this
  -- profile, and a brand reading its own history should see that the
  -- creator existed and has gone, not a blank where a person was.
  UPDATE public.profiles
  SET full_name  = 'Deleted account',
      email      = 'deleted+' || LEFT(p_user::text, 8) || '@covo.invalid',
      avatar_url = NULL,
      status     = 'deleted',
      deleted_at = NOW()
  WHERE id = p_user;

  UPDATE public.creator_profiles
  SET legal_first_name        = NULL,
      legal_last_name         = NULL,
      phone                   = NULL,
      bio                     = NULL,
      location                = NULL,
      gender                  = NULL,
      primary_handle          = NULL,
      tiktok_handle           = NULL,
      instagram_handle        = NULL,
      youtube_handle          = NULL,
      bank_account_name       = NULL,
      bank_account_last4      = NULL,
      bank_code               = NULL,
      bank_name               = NULL,
      -- The recipient stays at Paystack, but COVO stops holding the
      -- handle that could send money to it.
      paystack_recipient_code = NULL
  WHERE id = p_user;

  UPDATE public.brand_profiles
  SET website  = NULL,
      bio      = NULL,
      logo_url = NULL
  WHERE id = p_user;

  RETURN QUERY SELECT true, NULL::TEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.anonymise_account(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.anonymise_account(UUID) TO service_role;


-- ── A deleted account cannot sign back in ────────────────────────────
-- Belt and braces alongside the auth-level ban: even with a valid token,
-- the profile read that every dashboard depends on returns nothing.
DROP POLICY IF EXISTS "users read own profile" ON public.profiles;
CREATE POLICY "users read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id AND status <> 'deleted');


DO $do$
DECLARE _n INT;
BEGIN
  SELECT COUNT(*) INTO _n FROM public.profiles WHERE status = 'deleted';
  RAISE NOTICE 'profiles: % deleted account(s) on record.', _n;
END;
$do$;
