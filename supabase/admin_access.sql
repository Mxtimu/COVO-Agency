-- ════════════════════════════════════════════════════════════════════
-- COVO — admin read access
-- schema_full.sql drops "admins manage profiles" but never recreates it,
-- so profiles ends up readable only by its owner. Every admin panel reads
-- through profiles, so Creators/Brands/Applications all render empty.
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- A policy ON profiles cannot itself SELECT FROM profiles — Postgres would
-- re-apply the same policy to that subquery and recurse until it errors with
-- "infinite recursion detected in policy". SECURITY DEFINER runs as the
-- function owner and bypasses RLS, which breaks the cycle.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- ── profiles ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admins read all profiles"   ON public.profiles;
DROP POLICY IF EXISTS "admins update all profiles" ON public.profiles;

CREATE POLICY "admins read all profiles"   ON public.profiles
  FOR SELECT USING (public.is_admin());
CREATE POLICY "admins update all profiles" ON public.profiles
  FOR UPDATE USING (public.is_admin());

-- ── side tables ──────────────────────────────────────────────────────
-- These already had admin policies, but they each ran a correlated subquery
-- against profiles on every row. is_admin() is STABLE, so Postgres evaluates
-- it once per statement instead.
DROP POLICY IF EXISTS "admins manage creator profiles" ON public.creator_profiles;
CREATE POLICY "admins manage creator profiles" ON public.creator_profiles
  FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "admins manage brand profiles" ON public.brand_profiles;
CREATE POLICY "admins manage brand profiles" ON public.brand_profiles
  FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "admins manage campaigns" ON public.campaigns;
CREATE POLICY "admins manage campaigns" ON public.campaigns
  FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "admins manage products" ON public.products;
CREATE POLICY "admins manage products" ON public.products
  FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "admins manage links" ON public.affiliate_links;
CREATE POLICY "admins manage links" ON public.affiliate_links
  FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "admins manage clicks" ON public.clicks;
CREATE POLICY "admins manage clicks" ON public.clicks
  FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "admins manage commissions" ON public.commissions;
CREATE POLICY "admins manage commissions" ON public.commissions
  FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "admins manage escrow" ON public.campaign_escrow;
CREATE POLICY "admins manage escrow" ON public.campaign_escrow
  FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "admins manage tranches" ON public.escrow_tranches;
CREATE POLICY "admins manage tranches" ON public.escrow_tranches
  FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "admins manage payouts" ON public.payouts;
CREATE POLICY "admins manage payouts" ON public.payouts
  FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "admins manage disputes" ON public.disputes;
CREATE POLICY "admins manage disputes" ON public.disputes
  FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "admins manage applications" ON public.campaign_applications;
CREATE POLICY "admins manage applications" ON public.campaign_applications
  FOR ALL USING (public.is_admin());
