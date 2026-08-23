-- ════════════════════════════════════════════════════════════════════
-- COVO — escrow balance RPCs
-- Called by the paystack-webhook and commission-confirmation Edge
-- Functions. Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- Brand deposits land here (paystack-webhook, on charge.success).
CREATE OR REPLACE FUNCTION public.increment_escrow_balance(
  p_escrow_id UUID,
  p_amount    NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Deposit amount must be positive, got %', p_amount;
  END IF;

  UPDATE public.campaign_escrow
  SET balance         = balance + p_amount,
      total_deposited = total_deposited + p_amount
  WHERE id = p_escrow_id;
END;
$$;

-- Confirmed commissions are drawn down from here (commission-confirmation).
-- Keyed by campaign_id because that is what the commission row carries.
CREATE OR REPLACE FUNCTION public.decrement_escrow_balance(
  p_campaign_id UUID,
  p_amount      NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Debit amount must be positive, got %', p_amount;
  END IF;

  UPDATE public.campaign_escrow
  SET balance        = balance - p_amount,
      total_paid_out = total_paid_out + p_amount
  WHERE campaign_id = p_campaign_id;
END;
$$;

-- These move money. Only the service_role key (used by Edge Functions) may
-- call them — never a logged-in browser session, which holds the anon key.
REVOKE EXECUTE ON FUNCTION public.increment_escrow_balance(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_escrow_balance(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_escrow_balance(UUID, NUMERIC) TO service_role;
GRANT  EXECUTE ON FUNCTION public.decrement_escrow_balance(UUID, NUMERIC) TO service_role;

-- ── affiliate_links.slug ─────────────────────────────────────────────
-- generate-affiliate-assets upserts on slug and affiliate-redirect looks
-- links up by it, so the column must exist and be unique. The table on the
-- client's project predates schema_full.sql, so neither is guaranteed.

-- An older draft of the schema called this column short_code. Rename rather
-- than add, so any existing links keep working.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'affiliate_links' AND column_name = 'short_code'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'affiliate_links' AND column_name = 'slug'
  ) THEN
    ALTER TABLE public.affiliate_links RENAME COLUMN short_code TO slug;
  END IF;
END;
$$;

ALTER TABLE public.affiliate_links ADD COLUMN IF NOT EXISTS slug TEXT;

-- A UNIQUE constraint tolerates NULLs, but the redirect lookup cannot —
-- give any pre-existing rows a deterministic placeholder.
UPDATE public.affiliate_links
SET slug = 'link-' || left(id::text, 8)
WHERE slug IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.affiliate_links'::regclass
      AND contype  = 'u'
      AND conname  = 'affiliate_links_slug_key'
  ) THEN
    ALTER TABLE public.affiliate_links ADD CONSTRAINT affiliate_links_slug_key UNIQUE (slug);
  END IF;
END;
$$;
