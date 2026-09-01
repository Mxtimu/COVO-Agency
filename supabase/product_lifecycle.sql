-- ════════════════════════════════════════════════════════════════════
-- COVO — retiring a product without breaking what it sold
--
-- products.id is referenced by affiliate_links, clicks and commissions,
-- every one of them ON DELETE SET NULL. So deleting a product did three
-- things at once, none of them announced:
--
--   1. every creator link pointing at it started returning 404, because
--      affiliate-redirect resolves the destination through product_id;
--   2. every past commission forgot which product it was earned on, so
--      the record of what was actually sold was destroyed retroactively;
--   3. the brand saw a confirm() dialog that could not tell them how
--      many creators they were about to cut off, because nothing counted.
--
-- The third is what made the first two possible. A brand fixing a typo
-- had no way to know the difference between deleting a product nobody
-- had linked yet and deleting one carrying live traffic.
--
-- Editing already exists — it was added in 263ca32, and the delete
-- confirmation already points people at it. What was missing is a safe
-- way to retire a product that has history. That is archiving: the
-- product stops being offered to creators and stops accruing new links,
-- while every existing link, click and commission keeps resolving.
--
-- Hard deletion survives, but only for a product nothing references yet
-- — the genuine "I just typed this in wrong" case.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_products_campaign_active
  ON public.products (campaign_id) WHERE archived_at IS NULL;


-- ── Creators only see products still on offer ────────────────────────
-- An archived product must not appear in a campaign a creator is
-- browsing, or they would apply for something the brand has retired.
DROP POLICY IF EXISTS "creators read products" ON public.products;
CREATE POLICY "creators read products" ON public.products FOR SELECT USING (
  archived_at IS NULL
  AND EXISTS (SELECT 1 FROM public.campaigns WHERE id = campaign_id AND status = 'active')
);

-- The brand keeps seeing its own, archived or not — it has to, to
-- restore them.
DROP POLICY IF EXISTS "brands manage products" ON public.products;
CREATE POLICY "brands manage products" ON public.products FOR ALL USING (
  EXISTS (SELECT 1 FROM public.campaigns WHERE id = campaign_id AND brand_id = auth.uid()));


-- ── Refuse to delete a product that carries history ──────────────────
-- A BEFORE DELETE trigger rather than a client-side check, because the
-- client is not the only thing that can issue a DELETE. This is the
-- guarantee; the UI just explains it politely first.
CREATE OR REPLACE FUNCTION public.guard_product_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER SET search_path = public
AS $fn$
DECLARE
  _links       INT;
  _commissions INT;
BEGIN
  SELECT COUNT(*) INTO _links       FROM public.affiliate_links WHERE product_id = OLD.id;
  SELECT COUNT(*) INTO _commissions FROM public.commissions     WHERE product_id = OLD.id;

  IF _links > 0 OR _commissions > 0 THEN
    RAISE EXCEPTION
      'This product has % creator link(s) and % recorded sale(s). Deleting it would break those links and erase which product each sale was for. Archive it instead — existing links keep working and creators stop seeing it.',
      _links, _commissions
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS guard_product_delete ON public.products;
CREATE TRIGGER guard_product_delete
  BEFORE DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.guard_product_delete();


-- ── What a brand needs to see before deciding ────────────────────────
-- The counts that make the consequence visible: how many creators are
-- carrying this link, how much traffic it has taken, what it has earned.
CREATE OR REPLACE FUNCTION public.product_usage(p_campaign_id UUID)
RETURNS TABLE (
  product_id   UUID,
  links        INT,
  creators     INT,
  clicks       INT,
  commissions  INT,
  revenue      NUMERIC,
  can_delete   BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
  SELECT
    p.id,
    (SELECT COUNT(*)             FROM public.affiliate_links l WHERE l.product_id = p.id)::INT,
    (SELECT COUNT(DISTINCT l.creator_id) FROM public.affiliate_links l WHERE l.product_id = p.id)::INT,
    (SELECT COUNT(*)             FROM public.clicks c         WHERE c.product_id = p.id)::INT,
    (SELECT COUNT(*)             FROM public.commissions c    WHERE c.product_id = p.id)::INT,
    (SELECT COALESCE(SUM(c.sale_amount), 0) FROM public.commissions c
       WHERE c.product_id = p.id AND c.status <> 'denied'),
    NOT EXISTS (SELECT 1 FROM public.affiliate_links l WHERE l.product_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM public.commissions c WHERE c.product_id = p.id)
  FROM public.products p
  WHERE p.campaign_id = p_campaign_id
    -- SECURITY DEFINER bypasses RLS, so the caller check is explicit.
    AND (
      public.is_admin()
      OR EXISTS (SELECT 1 FROM public.campaigns ca
                 WHERE ca.id = p_campaign_id AND ca.brand_id = auth.uid())
    );
$fn$;

REVOKE EXECUTE ON FUNCTION public.product_usage(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.product_usage(UUID) TO authenticated, service_role;


-- ── Verify ───────────────────────────────────────────────────────────
DO $do$
DECLARE
  _orphan_links INT;
  _orphan_comms INT;
BEGIN
  SELECT COUNT(*) INTO _orphan_links FROM public.affiliate_links WHERE product_id IS NULL;
  SELECT COUNT(*) INTO _orphan_comms FROM public.commissions     WHERE product_id IS NULL;

  IF _orphan_links > 0 THEN
    RAISE NOTICE 'products: % affiliate link(s) already have no product — those are dead links from deletions before this guard existed. They return 404 and need regenerating.', _orphan_links;
  END IF;
  IF _orphan_comms > 0 THEN
    RAISE NOTICE 'products: % commission(s) have no product reference. The sale is intact; only which product it was for is gone.', _orphan_comms;
  END IF;
  IF _orphan_links = 0 AND _orphan_comms = 0 THEN
    RAISE NOTICE 'products: no orphaned links or commissions — nothing was lost before the guard went in.';
  END IF;
END;
$do$;
