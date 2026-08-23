-- ════════════════════════════════════════════════════════════════════
-- COVO — conversion tracking
-- Adds the order reference that record-conversion needs, and the platform
-- fee constant. Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS external_order_id TEXT,
  ADD COLUMN IF NOT EXISTS currency          TEXT NOT NULL DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS source            TEXT NOT NULL DEFAULT 'shopify';

-- An order-confirmation page is refreshed, bookmarked and reopened all the
-- time. Without this constraint each reload would insert another commission
-- and the brand would pay the creator repeatedly for one sale.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.commissions'::regclass
      AND conname  = 'commissions_campaign_order_key'
  ) THEN
    ALTER TABLE public.commissions
      ADD CONSTRAINT commissions_campaign_order_key UNIQUE (campaign_id, external_order_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_commissions_order ON public.commissions(external_order_id);

-- Creators need to see their own earnings; brands need to see what a campaign
-- is costing them. Both already exist, but re-assert them here so this file
-- stands alone.
DROP POLICY IF EXISTS "creators read own commissions" ON public.commissions;
CREATE POLICY "creators read own commissions" ON public.commissions
  FOR SELECT USING (creator_id = auth.uid());

DROP POLICY IF EXISTS "brands read own commissions" ON public.commissions;
CREATE POLICY "brands read own commissions" ON public.commissions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.campaigns WHERE id = campaign_id AND brand_id = auth.uid()));
