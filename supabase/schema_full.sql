-- ════════════════════════════════════════════════════════════════════
-- COVO — FULL SCHEMA (idempotent)
-- Safe to run repeatedly. Every trigger and policy is dropped before
-- being recreated, so partial or pre-existing state is not an error.
-- Paste the whole file into the Supabase SQL Editor and run once.
-- ════════════════════════════════════════════════════════════════════

-- ── SHARED: updated_at trigger function ──────────────────────────────
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ════════════════════════════════════════════════════════════════════
-- 1. PROFILES  (+ role assignment trigger)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  full_name  TEXT,
  avatar_url TEXT,
  role       TEXT NOT NULL DEFAULT 'creator' CHECK (role IN ('creator','brand','admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- in case the table pre-existed with a different shape
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email      TEXT,
  ADD COLUMN IF NOT EXISTS full_name  TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS role       TEXT NOT NULL DEFAULT 'creator',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS status     TEXT NOT NULL DEFAULT 'pending';

-- CHECK constraints are added separately: ADD COLUMN IF NOT EXISTS skips the
-- inline CHECK when the column already exists on a pre-existing table.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_role_check
  CHECK (role IN ('creator','brand','admin'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_status_check
  CHECK (status IN ('pending','approved','suspended'));

DROP TRIGGER IF EXISTS on_profile_updated ON public.profiles;
CREATE TRIGGER on_profile_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Sole authority for role assignment. SECURITY DEFINER so it can write to
-- public.profiles during the auth.users insert. 'admin' is never accepted
-- from user metadata — it can only be granted by manual DB intervention.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _role TEXT;
BEGIN
  _role := COALESCE(NEW.raw_user_meta_data->>'user_type', 'creator');
  IF _role NOT IN ('creator','brand') THEN
    _role := 'creator';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url',
    _role
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own profile"    ON public.profiles;
DROP POLICY IF EXISTS "users update own profile"  ON public.profiles;
DROP POLICY IF EXISTS "admins manage profiles"    ON public.profiles;
-- legacy names from earlier runs
DROP POLICY IF EXISTS "Users can view own profile"   ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "users read own profile"   ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);


-- ════════════════════════════════════════════════════════════════════
-- 2. CREATOR PROFILES
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.creator_profiles (
  id                     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  guardrail_acknowledged BOOLEAN NOT NULL DEFAULT false,
  joined_campaign_ids    UUID[] DEFAULT '{}',
  tiktok_handle          TEXT,
  instagram_handle       TEXT,
  youtube_handle         TEXT,
  niche                  TEXT,
  follower_count         INTEGER DEFAULT 0,
  bio                    TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- in case the table pre-existed with a different shape
ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS guardrail_acknowledged  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS joined_campaign_ids     UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tiktok_handle           TEXT,
  ADD COLUMN IF NOT EXISTS instagram_handle        TEXT,
  ADD COLUMN IF NOT EXISTS youtube_handle          TEXT,
  ADD COLUMN IF NOT EXISTS niche                   TEXT,
  ADD COLUMN IF NOT EXISTS follower_count          INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bio                     TEXT,
  ADD COLUMN IF NOT EXISTS created_at              TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at              TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS covo_score              INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS covo_score_updated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_verified             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_account_name       TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number     TEXT,
  ADD COLUMN IF NOT EXISTS bank_name               TEXT,
  ADD COLUMN IF NOT EXISTS paystack_recipient_code TEXT;

ALTER TABLE public.creator_profiles DROP CONSTRAINT IF EXISTS creator_profiles_covo_score_check;
ALTER TABLE public.creator_profiles ADD  CONSTRAINT creator_profiles_covo_score_check
  CHECK (covo_score BETWEEN 0 AND 100);

DROP TRIGGER IF EXISTS on_creator_profile_updated ON public.creator_profiles;
CREATE TRIGGER on_creator_profile_updated
  BEFORE UPDATE ON public.creator_profiles
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "creators read own profile"      ON public.creator_profiles;
DROP POLICY IF EXISTS "creators update own profile"    ON public.creator_profiles;
DROP POLICY IF EXISTS "creators insert own profile"    ON public.creator_profiles;
DROP POLICY IF EXISTS "admins manage creator profiles" ON public.creator_profiles;

CREATE POLICY "creators read own profile"   ON public.creator_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "creators update own profile" ON public.creator_profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "creators insert own profile" ON public.creator_profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "admins manage creator profiles" ON public.creator_profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));


-- ════════════════════════════════════════════════════════════════════
-- 3. BRAND PROFILES
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.brand_profiles (
  id                  UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_name        TEXT,
  website             TEXT,
  industry            TEXT,
  bio                 TEXT,
  logo_url            TEXT,
  onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- in case the table pre-existed without these
ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS company_name        TEXT,
  ADD COLUMN IF NOT EXISTS website             TEXT,
  ADD COLUMN IF NOT EXISTS industry            TEXT,
  ADD COLUMN IF NOT EXISTS bio                 TEXT,
  ADD COLUMN IF NOT EXISTS logo_url            TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT NOW();

DROP TRIGGER IF EXISTS on_brand_profile_updated ON public.brand_profiles;
CREATE TRIGGER on_brand_profile_updated
  BEFORE UPDATE ON public.brand_profiles
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.brand_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "brands read own profile"      ON public.brand_profiles;
DROP POLICY IF EXISTS "brands update own profile"    ON public.brand_profiles;
DROP POLICY IF EXISTS "brands insert own profile"    ON public.brand_profiles;
DROP POLICY IF EXISTS "admins manage brand profiles" ON public.brand_profiles;

CREATE POLICY "brands read own profile"   ON public.brand_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "brands update own profile" ON public.brand_profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "brands insert own profile" ON public.brand_profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "admins manage brand profiles" ON public.brand_profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));


-- ════════════════════════════════════════════════════════════════════
-- 4. CAMPAIGNS / PRODUCTS / AFFILIATE LINKS
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.campaigns (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  description        TEXT,
  commission_rate    NUMERIC(5,2) NOT NULL DEFAULT 10,
  return_window_days INTEGER NOT NULL DEFAULT 14,
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','paused','closed')),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- in case the table pre-existed with a different shape
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS description        TEXT,
  ADD COLUMN IF NOT EXISTS commission_rate    NUMERIC(5,2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS return_window_days INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE public.campaigns ADD  CONSTRAINT campaigns_status_check
  CHECK (status IN ('pending','active','paused','closed'));

DROP TRIGGER IF EXISTS on_campaign_updated ON public.campaigns;
CREATE TRIGGER on_campaign_updated
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "brands read own campaigns"     ON public.campaigns;
DROP POLICY IF EXISTS "brands insert campaigns"       ON public.campaigns;
DROP POLICY IF EXISTS "brands update own campaigns"   ON public.campaigns;
DROP POLICY IF EXISTS "creators read active campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "admins manage campaigns"       ON public.campaigns;

CREATE POLICY "brands read own campaigns"      ON public.campaigns FOR SELECT USING (brand_id = auth.uid());
CREATE POLICY "brands insert campaigns"        ON public.campaigns FOR INSERT WITH CHECK (brand_id = auth.uid());
CREATE POLICY "brands update own campaigns"    ON public.campaigns FOR UPDATE USING (brand_id = auth.uid());
CREATE POLICY "creators read active campaigns" ON public.campaigns FOR SELECT USING (status = 'active');
CREATE POLICY "admins manage campaigns"        ON public.campaigns FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  price        NUMERIC(12,2),
  tracking_url TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- in case the table pre-existed with a different shape
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price        NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "brands manage products"  ON public.products;
DROP POLICY IF EXISTS "brands read own products" ON public.products;
DROP POLICY IF EXISTS "creators read products"  ON public.products;
DROP POLICY IF EXISTS "admins manage products"  ON public.products;

CREATE POLICY "brands manage products"  ON public.products FOR ALL USING (
  EXISTS (SELECT 1 FROM public.campaigns WHERE id = campaign_id AND brand_id = auth.uid()));
CREATE POLICY "creators read products"  ON public.products FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.campaigns WHERE id = campaign_id AND status = 'active'));
CREATE POLICY "admins manage products"  ON public.products FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.affiliate_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES public.products(id) ON DELETE SET NULL,
  slug        TEXT UNIQUE NOT NULL,
  clicks      INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- in case the table pre-existed with a different shape
ALTER TABLE public.affiliate_links
  ADD COLUMN IF NOT EXISTS product_id       UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clicks           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS brand_slug       TEXT,
  ADD COLUMN IF NOT EXISTS creator_username TEXT,
  ADD COLUMN IF NOT EXISTS discount_code    TEXT;

ALTER TABLE public.affiliate_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "creators read own links" ON public.affiliate_links;
DROP POLICY IF EXISTS "creators insert links"   ON public.affiliate_links;
DROP POLICY IF EXISTS "admins manage links"     ON public.affiliate_links;

CREATE POLICY "creators read own links" ON public.affiliate_links FOR SELECT USING (creator_id = auth.uid());
CREATE POLICY "creators insert links"   ON public.affiliate_links FOR INSERT WITH CHECK (creator_id = auth.uid());
CREATE POLICY "admins manage links"     ON public.affiliate_links FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));


-- ════════════════════════════════════════════════════════════════════
-- 5. CLICKS
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.clicks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_link_id UUID REFERENCES public.affiliate_links(id) ON DELETE SET NULL,
  creator_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  campaign_id       UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  product_id        UUID REFERENCES public.products(id) ON DELETE SET NULL,
  ip_hash           TEXT,
  user_agent        TEXT,
  referrer          TEXT,
  clicked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.clicks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "creators read own clicks" ON public.clicks;
DROP POLICY IF EXISTS "admins manage clicks"     ON public.clicks;

CREATE POLICY "creators read own clicks" ON public.clicks FOR SELECT USING (creator_id = auth.uid());
CREATE POLICY "admins manage clicks"     ON public.clicks FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_clicks_link    ON public.clicks(affiliate_link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_creator ON public.clicks(creator_id);
CREATE INDEX IF NOT EXISTS idx_clicks_time    ON public.clicks(clicked_at);


-- ════════════════════════════════════════════════════════════════════
-- 6. COMMISSIONS
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.commissions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  campaign_id        UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  product_id         UUID REFERENCES public.products(id) ON DELETE SET NULL,
  affiliate_link_id  UUID REFERENCES public.affiliate_links(id) ON DELETE SET NULL,
  click_id           UUID REFERENCES public.clicks(id) ON DELETE SET NULL,
  sale_amount        NUMERIC(12,2) NOT NULL,
  commission_rate    NUMERIC(5,2)  NOT NULL,
  gross_commission   NUMERIC(12,2) NOT NULL,
  platform_fee       NUMERIC(12,2) NOT NULL,   -- 8% of gross
  net_commission     NUMERIC(12,2) NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','paid','held','denied')),
  return_window_days INTEGER NOT NULL DEFAULT 14,
  confirms_at        TIMESTAMPTZ,
  payout_id          UUID,
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "creators read own commissions" ON public.commissions;
DROP POLICY IF EXISTS "brands read own commissions"   ON public.commissions;
DROP POLICY IF EXISTS "admins manage commissions"     ON public.commissions;

CREATE POLICY "creators read own commissions" ON public.commissions FOR SELECT USING (creator_id = auth.uid());
CREATE POLICY "brands read own commissions"   ON public.commissions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.campaigns WHERE id = campaign_id AND brand_id = auth.uid()));
CREATE POLICY "admins manage commissions"     ON public.commissions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_commissions_creator     ON public.commissions(creator_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status      ON public.commissions(status);
CREATE INDEX IF NOT EXISTS idx_commissions_confirms_at ON public.commissions(confirms_at);

DROP TRIGGER IF EXISTS set_updated_at_commissions ON public.commissions;
CREATE TRIGGER set_updated_at_commissions
  BEFORE UPDATE ON public.commissions
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ════════════════════════════════════════════════════════════════════
-- 7. CAMPAIGN ESCROW
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.campaign_escrow (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id             UUID NOT NULL UNIQUE REFERENCES public.campaigns(id) ON DELETE CASCADE,
  brand_id                UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_deposited         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_paid_out          NUMERIC(12,2) NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','closed')),
  low_balance_notified_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.campaign_escrow ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "brands read own escrow" ON public.campaign_escrow;
DROP POLICY IF EXISTS "admins manage escrow"   ON public.campaign_escrow;

CREATE POLICY "brands read own escrow" ON public.campaign_escrow FOR SELECT USING (brand_id = auth.uid());
CREATE POLICY "admins manage escrow"   ON public.campaign_escrow FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP TRIGGER IF EXISTS set_updated_at_escrow ON public.campaign_escrow;
CREATE TRIGGER set_updated_at_escrow
  BEFORE UPDATE ON public.campaign_escrow
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ════════════════════════════════════════════════════════════════════
-- 8. ESCROW TRANCHES
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.escrow_tranches (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id          UUID NOT NULL REFERENCES public.campaign_escrow(id) ON DELETE CASCADE,
  campaign_id        UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  brand_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount             NUMERIC(12,2) NOT NULL,
  paystack_reference TEXT UNIQUE,
  paystack_status    TEXT NOT NULL DEFAULT 'pending'
    CHECK (paystack_status IN ('pending','success','failed')),
  deposited_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.escrow_tranches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "brands read own tranches" ON public.escrow_tranches;
DROP POLICY IF EXISTS "brands insert tranches"   ON public.escrow_tranches;
DROP POLICY IF EXISTS "admins manage tranches"   ON public.escrow_tranches;

CREATE POLICY "brands read own tranches" ON public.escrow_tranches FOR SELECT USING (brand_id = auth.uid());
CREATE POLICY "brands insert tranches"   ON public.escrow_tranches FOR INSERT WITH CHECK (brand_id = auth.uid());
CREATE POLICY "admins manage tranches"   ON public.escrow_tranches FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));


-- ════════════════════════════════════════════════════════════════════
-- 9. PAYOUTS
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.payouts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount                 NUMERIC(12,2) NOT NULL,
  paystack_transfer_code TEXT,
  paystack_reference     TEXT UNIQUE,
  status                 TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','success','failed','reversed')),
  initiated_by           UUID REFERENCES public.profiles(id),
  commission_ids         UUID[] DEFAULT '{}',
  processed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "creators read own payouts" ON public.payouts;
DROP POLICY IF EXISTS "admins manage payouts"     ON public.payouts;

CREATE POLICY "creators read own payouts" ON public.payouts FOR SELECT USING (creator_id = auth.uid());
CREATE POLICY "admins manage payouts"     ON public.payouts FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_payouts_creator ON public.payouts(creator_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status  ON public.payouts(status);

DROP TRIGGER IF EXISTS set_updated_at_payouts ON public.payouts;
CREATE TRIGGER set_updated_at_payouts
  BEFORE UPDATE ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ════════════════════════════════════════════════════════════════════
-- 10. DISPUTES
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.disputes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raised_by        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  campaign_id      UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  commission_id    UUID REFERENCES public.commissions(id) ON DELETE SET NULL,
  type             TEXT NOT NULL
    CHECK (type IN ('commission_denial','unconfirmed_sale','brand_safety','other')),
  description      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','under_review','resolved','dismissed')),
  resolved_by      UUID REFERENCES public.profiles(id),
  resolution_notes TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read own disputes" ON public.disputes;
DROP POLICY IF EXISTS "users insert disputes"   ON public.disputes;
DROP POLICY IF EXISTS "admins manage disputes"  ON public.disputes;

CREATE POLICY "users read own disputes" ON public.disputes FOR SELECT USING (raised_by = auth.uid());
CREATE POLICY "users insert disputes"   ON public.disputes FOR INSERT WITH CHECK (raised_by = auth.uid());
CREATE POLICY "admins manage disputes"  ON public.disputes FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_disputes_status ON public.disputes(status);

DROP TRIGGER IF EXISTS set_updated_at_disputes ON public.disputes;
CREATE TRIGGER set_updated_at_disputes
  BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ════════════════════════════════════════════════════════════════════
-- BACKFILL: create profile rows for any auth.users that predate the trigger
-- ════════════════════════════════════════════════════════════════════
INSERT INTO public.profiles (id, email, full_name, avatar_url, role)
SELECT
  u.id,
  u.email,
  COALESCE(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(COALESCE(u.email, ''), '@', 1)
  ),
  u.raw_user_meta_data->>'avatar_url',
  CASE WHEN u.raw_user_meta_data->>'user_type' = 'brand' THEN 'brand' ELSE 'creator' END
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
