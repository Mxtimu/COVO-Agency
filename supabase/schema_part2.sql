-- ════════════════════════════════════════════════════════════════════
-- COVO SCHEMA PART 2  (Sections 11-20)
-- Run each block separately in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════════

-- ── BLOCK 1: Alter existing tables ───────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','suspended'));

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS covo_score          INTEGER NOT NULL DEFAULT 0
    CHECK (covo_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS covo_score_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_verified         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_account_name   TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_name           TEXT,
  ADD COLUMN IF NOT EXISTS paystack_recipient_code TEXT;

ALTER TABLE affiliate_links
  ADD COLUMN IF NOT EXISTS brand_slug     TEXT,
  ADD COLUMN IF NOT EXISTS creator_username TEXT,
  ADD COLUMN IF NOT EXISTS discount_code  TEXT;

-- ── BLOCK 2: CLICKS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clicks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_link_id UUID        REFERENCES affiliate_links(id) ON DELETE SET NULL,
  creator_id        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  campaign_id       UUID        REFERENCES campaigns(id) ON DELETE SET NULL,
  product_id        UUID        REFERENCES products(id) ON DELETE SET NULL,
  ip_hash           TEXT,
  user_agent        TEXT,
  referrer          TEXT,
  clicked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE clicks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "creators read own clicks"  ON clicks FOR SELECT USING (creator_id = auth.uid());
CREATE POLICY "admins manage clicks"      ON clicks FOR ALL    USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_clicks_link    ON clicks(affiliate_link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_creator ON clicks(creator_id);
CREATE INDEX IF NOT EXISTS idx_clicks_time    ON clicks(clicked_at);

-- ── BLOCK 3: COMMISSIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commissions (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id        UUID          NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  campaign_id       UUID          NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  product_id        UUID          REFERENCES products(id) ON DELETE SET NULL,
  affiliate_link_id UUID          REFERENCES affiliate_links(id) ON DELETE SET NULL,
  click_id          UUID          REFERENCES clicks(id) ON DELETE SET NULL,
  sale_amount       NUMERIC(12,2) NOT NULL,
  commission_rate   NUMERIC(5,2)  NOT NULL,
  gross_commission  NUMERIC(12,2) NOT NULL,
  platform_fee      NUMERIC(12,2) NOT NULL,   -- 8% of gross
  net_commission    NUMERIC(12,2) NOT NULL,
  status            TEXT          NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','paid','held','denied')),
  return_window_days INTEGER      NOT NULL DEFAULT 14,
  confirms_at       TIMESTAMPTZ,
  payout_id         UUID,
  notes             TEXT,
  created_at        TIMESTAMPTZ   DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   DEFAULT NOW()
);
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "creators read own commissions" ON commissions FOR SELECT USING (creator_id = auth.uid());
CREATE POLICY "admins manage commissions"     ON commissions FOR ALL    USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_commissions_creator     ON commissions(creator_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status      ON commissions(status);
CREATE INDEX IF NOT EXISTS idx_commissions_confirms_at ON commissions(confirms_at);
CREATE TRIGGER set_updated_at_commissions
  BEFORE UPDATE ON commissions FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ── BLOCK 4: CAMPAIGN ESCROW ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_escrow (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id             UUID          NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
  brand_id                UUID          NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  balance                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_deposited         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_paid_out          NUMERIC(12,2) NOT NULL DEFAULT 0,
  status                  TEXT          NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','closed')),
  low_balance_notified_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ   DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   DEFAULT NOW()
);
ALTER TABLE campaign_escrow ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brands read own escrow"  ON campaign_escrow FOR SELECT USING (brand_id = auth.uid());
CREATE POLICY "admins manage escrow"    ON campaign_escrow FOR ALL    USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE TRIGGER set_updated_at_escrow
  BEFORE UPDATE ON campaign_escrow FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ── BLOCK 5: ESCROW TRANCHES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escrow_tranches (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id          UUID          NOT NULL REFERENCES campaign_escrow(id) ON DELETE CASCADE,
  campaign_id        UUID          NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  brand_id           UUID          NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount             NUMERIC(12,2) NOT NULL,
  paystack_reference TEXT          UNIQUE,
  paystack_status    TEXT          NOT NULL DEFAULT 'pending'
    CHECK (paystack_status IN ('pending','success','failed')),
  deposited_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ   DEFAULT NOW()
);
ALTER TABLE escrow_tranches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brands read own tranches" ON escrow_tranches FOR SELECT USING (brand_id = auth.uid());
CREATE POLICY "brands insert tranches"   ON escrow_tranches FOR INSERT WITH CHECK (brand_id = auth.uid());
CREATE POLICY "admins manage tranches"   ON escrow_tranches FOR ALL    USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ── BLOCK 6: PAYOUTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payouts (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id             UUID          NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount                 NUMERIC(12,2) NOT NULL,
  paystack_transfer_code TEXT,
  paystack_reference     TEXT          UNIQUE,
  status                 TEXT          NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','success','failed','reversed')),
  initiated_by           UUID          REFERENCES profiles(id),
  commission_ids         UUID[]        DEFAULT '{}',
  processed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ   DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   DEFAULT NOW()
);
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "creators read own payouts" ON payouts FOR SELECT USING (creator_id = auth.uid());
CREATE POLICY "admins manage payouts"     ON payouts FOR ALL    USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_payouts_creator ON payouts(creator_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status  ON payouts(status);
CREATE TRIGGER set_updated_at_payouts
  BEFORE UPDATE ON payouts FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ── BLOCK 7: DISPUTES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disputes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  raised_by        UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  campaign_id      UUID        REFERENCES campaigns(id) ON DELETE SET NULL,
  commission_id    UUID        REFERENCES commissions(id) ON DELETE SET NULL,
  type             TEXT        NOT NULL
    CHECK (type IN ('commission_denial','unconfirmed_sale','brand_safety','other')),
  description      TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','under_review','resolved','dismissed')),
  resolved_by      UUID        REFERENCES profiles(id),
  resolution_notes TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own disputes"  ON disputes FOR SELECT USING (raised_by = auth.uid());
CREATE POLICY "users insert disputes"    ON disputes FOR INSERT WITH CHECK (raised_by = auth.uid());
CREATE POLICY "admins manage disputes"   ON disputes FOR ALL    USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE TRIGGER set_updated_at_disputes
  BEFORE UPDATE ON disputes FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
