-- ════════════════════════════════════════════════════════════════════
-- COVO — privilege hardening
--
-- Row Level Security is row-level only. Every "update your own row"
-- policy in schema_full.sql therefore granted the owner write access to
-- EVERY column of that row, including the ones that decide what they are
-- allowed to do. Supabase grants UPDATE on public tables to the
-- `authenticated` role by default, so from any browser console:
--
--   supabase.from('profiles').update({ role: 'admin' }).eq('id', myId)
--
-- succeeded — profiles_role_check permits 'admin'. That is a complete
-- platform takeover from a signed-in creator account, and it silently
-- defeated the "'admin' is never accepted from user metadata" rule that
-- handle_new_user() was written to enforce.
--
-- The same shape let a creator write their own covo_score, and a brand
-- flip their own campaign to 'active' without review.
--
-- The fix is a BEFORE UPDATE guard per table that rejects changes to the
-- privileged columns unless the caller is an admin. Triggers are used
-- rather than column-level GRANTs because admins reach these columns
-- through the same `authenticated` role the panels already use, and a
-- column GRANT cannot tell the two apart.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- is_admin() is defined in admin_access.sql; repeated here so this file
-- stands alone, matching the convention in the rest of supabase/.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$fn$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- Distinguishes a PATCH straight from a browser (current_user is the
-- 'authenticated' or 'anon' role) from a write made on the platform's
-- behalf: an Edge Function holding service_role, or a SECURITY DEFINER
-- function like refresh_covo_score(), which runs as its owner.
--
-- The guards that call this MUST be SECURITY INVOKER. A SECURITY DEFINER
-- trigger would run as its own owner, current_user would read 'postgres'
-- on every write including a browser's, and every guard below would wave
-- everything through — the exact failure this file exists to prevent.
-- They need no elevated privilege anyway: they only compare NEW to OLD
-- and call is_admin(), which is SECURITY DEFINER in its own right.
CREATE OR REPLACE FUNCTION public.is_direct_client_write()
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
  SELECT current_user IN ('authenticated', 'anon');
$fn$;


-- ── profiles: role and status ────────────────────────────────────────
-- role decides what every other policy on every other table will allow.
-- status is the admin approval gate in AdminCreators / AdminBrands.
CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_direct_client_write() THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator may change a role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator may change an account status'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- id is the FK to auth.users and the subject of every RLS check.
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'A profile id cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS guard_profile_privileges ON public.profiles;
CREATE TRIGGER guard_profile_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileges();

-- WITH CHECK so the row still belongs to the caller after the update,
-- not only before it. Without it the USING clause is reused for the
-- check, which is correct here but implicit — state it.
DROP POLICY IF EXISTS "users update own profile" ON public.profiles;
CREATE POLICY "users update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);


-- ── creator_profiles: the score, verification and payout identity ────
-- covo_score is what a brand is buying. Leaving it client-writable made
-- the whole of covo_score.sql decorative: update({covo_score: 100})
-- passed the 0-100 CHECK and outranked every honestly-earned score.
CREATE OR REPLACE FUNCTION public.guard_creator_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_direct_client_write() THEN
    RETURN NEW;
  END IF;

  IF (NEW.covo_score            IS DISTINCT FROM OLD.covo_score
   OR NEW.covo_score_updated_at IS DISTINCT FROM OLD.covo_score_updated_at)
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'The COVO Score is calculated, not set'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator may change verification'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Written by Paystack onboarding, never by the creator: it is the
  -- destination every future transfer is sent to.
  IF NEW.paystack_recipient_code IS DISTINCT FROM OLD.paystack_recipient_code
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'The payout recipient is set by COVO, not by the creator'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS guard_creator_profile_privileges ON public.creator_profiles;
CREATE TRIGGER guard_creator_profile_privileges
  BEFORE UPDATE ON public.creator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_creator_profile_privileges();

DROP POLICY IF EXISTS "creators update own profile" ON public.creator_profiles;
CREATE POLICY "creators update own profile" ON public.creator_profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- An INSERT policy of WITH CHECK (auth.uid() = id) let a creator seed the
-- privileged columns on the way in, which the UPDATE guard would then
-- protect. The row is created by onboarding and by admin approval, so the
-- insert has to be pinned to the defaults.
DROP POLICY IF EXISTS "creators insert own profile" ON public.creator_profiles;
CREATE POLICY "creators insert own profile" ON public.creator_profiles
  FOR INSERT WITH CHECK (
    auth.uid() = id
    AND COALESCE(covo_score, 0) = 0
    AND COALESCE(is_verified, false) = false
    AND paystack_recipient_code IS NULL
  );


-- ── campaigns: only an admin may make one live ───────────────────────
-- Creators only ever see status = 'active' campaigns, and the escrow row
-- every downstream money operation looks up is created by the admin
-- approval step. A brand promoting its own campaign therefore published
-- an unfunded campaign with no escrow account behind it.
CREATE OR REPLACE FUNCTION public.guard_campaign_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.is_direct_client_write() THEN
    RETURN NEW;
  END IF;

  -- A brand may pause or close its own campaign; only COVO may open one.
  IF NEW.status = 'active' AND OLD.status <> 'active' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'A campaign is made live by COVO review, not by the brand'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.brand_id IS DISTINCT FROM OLD.brand_id THEN
    RAISE EXCEPTION 'A campaign cannot change hands'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS guard_campaign_status ON public.campaigns;
CREATE TRIGGER guard_campaign_status
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_status();

-- Campaigns are created pending and reviewed. Without the status pin a
-- brand could simply insert one that was already active.
DROP POLICY IF EXISTS "brands insert campaigns" ON public.campaigns;
CREATE POLICY "brands insert campaigns" ON public.campaigns
  FOR INSERT WITH CHECK (brand_id = auth.uid() AND status = 'pending');

DROP POLICY IF EXISTS "brands update own campaigns" ON public.campaigns;
CREATE POLICY "brands update own campaigns" ON public.campaigns
  FOR UPDATE USING (brand_id = auth.uid()) WITH CHECK (brand_id = auth.uid());


-- ── escrow_tranches: a deposit must point at your own escrow ─────────
-- The old policy checked only brand_id = auth.uid(), so the escrow_id and
-- campaign_id on the row were unverified — a brand could file a deposit
-- against another brand's escrow account.
DROP POLICY IF EXISTS "brands insert tranches" ON public.escrow_tranches;
CREATE POLICY "brands insert tranches" ON public.escrow_tranches
  FOR INSERT WITH CHECK (
    brand_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.campaign_escrow e
      WHERE e.id          = escrow_id
        AND e.campaign_id = campaign_id
        AND e.brand_id    = auth.uid()
    )
    -- Only the Paystack webhook may declare a deposit successful.
    AND paystack_status = 'pending'
  );


-- ── waitlist: keep the anon insert path off is_admin() ───────────────
-- "admins manage waitlist" is FOR ALL, so it applies to anon too, but
-- anon has no EXECUTE on is_admin(). The anonymous insert survives today
-- only because Postgres constant-folds `true OR is_admin()` away. Scope
-- the admin policy to authenticated so that stops being luck.
DROP POLICY IF EXISTS "admins manage waitlist" ON public.waitlist;
CREATE POLICY "admins manage waitlist" ON public.waitlist
  FOR ALL TO authenticated USING (public.is_admin());


-- ════════════════════════════════════════════════════════════════════
-- Brand visibility into its own creators
--
-- BrandCreators.jsx reads the creators promoting a brand's campaigns,
-- but profiles and creator_profiles were readable only by their owner
-- and by admins, so the panel had nothing to render even once its query
-- was correct. A creator who has accepted a campaign is working with
-- that brand — the brand can see who they are and what they score.
--
-- Scoped through affiliate_links, which only exist after admin approval.
-- Applying to a campaign reveals nothing; being approved onto one does.
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "brands read their campaign creators" ON public.profiles;
CREATE POLICY "brands read their campaign creators" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.affiliate_links l
      JOIN public.campaigns c ON c.id = l.campaign_id
      WHERE l.creator_id = profiles.id
        AND c.brand_id   = auth.uid()
    )
  );

DROP POLICY IF EXISTS "brands read their campaign creator profiles" ON public.creator_profiles;
CREATE POLICY "brands read their campaign creator profiles" ON public.creator_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.affiliate_links l
      JOIN public.campaigns c ON c.id = l.campaign_id
      WHERE l.creator_id = creator_profiles.id
        AND c.brand_id   = auth.uid()
    )
  );

-- Brands already read commissions on their own campaigns, but those rows
-- carry only creator_id. The policy above is what lets the join resolve
-- to a name in BrandOverview and BrandCreators.
