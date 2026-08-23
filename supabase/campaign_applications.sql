-- ════════════════════════════════════════════════════════════════════
-- COVO — campaign applications (admin-gated creator onboarding)
-- A creator applies to a campaign; an admin reviews. Affiliate links are
-- only minted on approval, which is what makes the COVO Score meaningful.
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.campaign_applications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id    UUID NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  campaign_id   UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  note          TEXT,
  reviewed_by   UUID REFERENCES public.profiles(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- One application per creator per campaign. Also the upsert conflict target,
-- so re-applying after a rejection updates rather than duplicating.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.campaign_applications'::regclass
      AND conname  = 'campaign_applications_creator_campaign_key'
  ) THEN
    ALTER TABLE public.campaign_applications
      ADD CONSTRAINT campaign_applications_creator_campaign_key UNIQUE (creator_id, campaign_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_applications_status   ON public.campaign_applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_creator  ON public.campaign_applications(creator_id);
CREATE INDEX IF NOT EXISTS idx_applications_campaign ON public.campaign_applications(campaign_id);

DROP TRIGGER IF EXISTS set_updated_at_applications ON public.campaign_applications;
CREATE TRIGGER set_updated_at_applications
  BEFORE UPDATE ON public.campaign_applications
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.campaign_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "creators read own applications"   ON public.campaign_applications;
DROP POLICY IF EXISTS "creators insert own applications" ON public.campaign_applications;
DROP POLICY IF EXISTS "brands read applications to own campaigns" ON public.campaign_applications;
DROP POLICY IF EXISTS "admins manage applications"       ON public.campaign_applications;

CREATE POLICY "creators read own applications"   ON public.campaign_applications
  FOR SELECT USING (creator_id = auth.uid());

-- Creators may only ever create a pending row for themselves. Without the
-- status check a creator could self-approve by inserting status='approved'.
CREATE POLICY "creators insert own applications"  ON public.campaign_applications
  FOR INSERT WITH CHECK (creator_id = auth.uid() AND status = 'pending');

CREATE POLICY "brands read applications to own campaigns" ON public.campaign_applications
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.campaigns WHERE id = campaign_id AND brand_id = auth.uid()));

CREATE POLICY "admins manage applications"       ON public.campaign_applications
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));


-- ── Let creators see who is behind a campaign ────────────────────────
-- brand_profiles is otherwise readable only by its owner, so the campaign
-- browser showed no company names. A brand running a live campaign is
-- publicly advertising for creators, so exposing that row is intended —
-- and it stays scoped to brands that actually have an active campaign.
DROP POLICY IF EXISTS "creators read brands of active campaigns" ON public.brand_profiles;
CREATE POLICY "creators read brands of active campaigns" ON public.brand_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.campaigns
      WHERE campaigns.brand_id = brand_profiles.id
        AND campaigns.status   = 'active'
    )
  );
