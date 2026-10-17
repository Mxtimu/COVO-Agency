-- ════════════════════════════════════════════════════════════════════
-- COVO — what a brand gets without paying for a plan
--
-- The free tier: one campaign, 25 creators, 30 days, and the same
-- R2,000 minimum deposit as any other campaign.
--
-- This is the half of subscription billing that does not depend on what
-- the plans cost. The guardrails are the same whether a paid tier is
-- R500 or R5,000 a month, so they are built now and tier selection and
-- recurring billing follow once the pricing is settled — that number
-- also has to go back to Paystack in the KYC answer, so it is worth
-- settling once rather than twice.
--
-- Nothing here charges anybody. It only decides what the free tier
-- allows, which means it can ship before billing exists and a brand on
-- the free tier is never in a half-billed state.
--
-- WHERE THE LIMITS ARE ENFORCED
--
--   One campaign  — a trigger on INSERT, because a brand that has
--                   already got two campaigns is a problem no later
--                   check can undo.
--   25 creators   — inside campaign_accepts_new_creators(), which
--                   campaign_lifecycle.sql already made the single gate
--                   on new invitations. Both limits answer one question
--                   ("may another creator join?"), so they belong in
--                   one place rather than two that can disagree.
--   30 days       — expires_at on the campaign, swept nightly. An
--                   expired free campaign closes the way any campaign
--                   closes, through close_campaign(), so the remaining
--                   balance is worked out and the creators still owed
--                   money are paid.
--
-- Run AFTER campaign_lifecycle.sql — it replaces a function defined
-- there. Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'free';

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brand_profiles_plan_tier_check'
  ) THEN
    ALTER TABLE public.brand_profiles
      ADD CONSTRAINT brand_profiles_plan_tier_check
      CHECK (plan_tier IN ('free', 'starter', 'growth', 'scale'));
  END IF;
END;
$do$;

-- The tier names are placeholders deliberately: they are needed so the
-- guardrail can ask "is this brand on free?", and nothing reads the
-- paid ones yet. Renaming them later touches one constraint.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- The limits, in one place, so a tier change is a data change.
CREATE OR REPLACE FUNCTION public.plan_limits(p_tier TEXT)
RETURNS TABLE (max_campaigns INT, max_creators_per_campaign INT, campaign_days INT)
LANGUAGE sql IMMUTABLE
AS $fn$
  -- t.tier is matched on, not returned: the declared output is three
  -- columns, so SELECT * over a four-column VALUES would not even
  -- create the function.
  SELECT t.mc, t.mcc, t.cd FROM (VALUES
    ('free',    1::INT, 25::INT, 30::INT),
    -- Paid tiers are not sold yet; NULL means "no limit" and is what
    -- every check below treats as unlimited.
    ('starter', NULL,   NULL,    NULL),
    ('growth',  NULL,   NULL,    NULL),
    ('scale',   NULL,   NULL,    NULL)
  ) AS t(tier, mc, mcc, cd)
  WHERE t.tier = COALESCE(p_tier, 'free');
$fn$;

GRANT EXECUTE ON FUNCTION public.plan_limits(TEXT) TO anon, authenticated, service_role;


-- ── May this brand start another campaign? ───────────────────────────
CREATE OR REPLACE FUNCTION public.brand_campaign_allowance(p_brand UUID)
RETURNS TABLE (
  tier           TEXT,
  campaigns_used INT,
  max_campaigns  INT,
  may_create     BOOLEAN,
  explanation    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
DECLARE
  _tier  TEXT;
  _lim   RECORD;
  _used  INT;
BEGIN
  SELECT COALESCE(bp.plan_tier, 'free') INTO _tier
  FROM public.brand_profiles bp WHERE bp.id = p_brand;

  _tier := COALESCE(_tier, 'free');
  SELECT * INTO _lim FROM public.plan_limits(_tier);

  -- A closed campaign does not count against the allowance: the free
  -- tier is one campaign at a time, not one campaign ever. Otherwise a
  -- brand that finished a campaign could never run another without
  -- paying, which would be a paywall disguised as a limit.
  SELECT COUNT(*)::INT INTO _used
  FROM public.campaigns c
  WHERE c.brand_id = p_brand AND c.status <> 'closed';

  IF _lim.max_campaigns IS NULL THEN
    RETURN QUERY SELECT _tier, _used, NULL::INT, true, NULL::TEXT;
    RETURN;
  END IF;

  IF _used < _lim.max_campaigns THEN
    RETURN QUERY SELECT _tier, _used, _lim.max_campaigns, true, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT _tier, _used, _lim.max_campaigns, false,
    format('The free plan covers one campaign at a time. Close "%s" or upgrade to run another.',
           (SELECT c.title FROM public.campaigns c
            WHERE c.brand_id = p_brand AND c.status <> 'closed'
            ORDER BY c.created_at LIMIT 1))::TEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.brand_campaign_allowance(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.brand_campaign_allowance(UUID) TO authenticated, service_role;


-- ── Enforce it on the way in ─────────────────────────────────────────
-- SECURITY INVOKER, like the guards in security_hardening.sql. A DEFINER
-- trigger would see current_user as its own owner on every write and
-- wave the whole thing through — the mistake that made the privilege
-- hardening a silent no-op the first time it was written.
CREATE OR REPLACE FUNCTION public.guard_campaign_allowance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE
  _allow RECORD;
  _lim   RECORD;
  _tier  TEXT;
BEGIN
  -- Admins and server-side callers are not subject to the plan. Seeding,
  -- migrations and support fixes are not a brand buying a campaign.
  IF NOT public.is_direct_client_write() THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _allow FROM public.brand_campaign_allowance(NEW.brand_id);

  IF _allow.may_create IS FALSE THEN
    RAISE EXCEPTION '%', _allow.explanation USING ERRCODE = 'check_violation';
  END IF;

  -- Stamp the expiry on the way in, so a free campaign cannot be created
  -- without one. The clock starts at activation, not creation — a brand
  -- drafting a campaign for a week should not lose a week of it.
  SELECT COALESCE(bp.plan_tier, 'free') INTO _tier
  FROM public.brand_profiles bp WHERE bp.id = NEW.brand_id;
  SELECT * INTO _lim FROM public.plan_limits(COALESCE(_tier, 'free'));

  IF _lim.campaign_days IS NOT NULL AND NEW.expires_at IS NULL
     AND NEW.status = 'active' THEN
    NEW.expires_at := NOW() + (_lim.campaign_days || ' days')::INTERVAL;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS enforce_campaign_allowance ON public.campaigns;
CREATE TRIGGER enforce_campaign_allowance
  BEFORE INSERT ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_allowance();


-- The clock starts when the campaign goes active, which may be later
-- than when it was created.
CREATE OR REPLACE FUNCTION public.stamp_campaign_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE
  _lim  RECORD;
  _tier TEXT;
BEGIN
  IF NEW.status = 'active' AND OLD.status <> 'active' AND NEW.expires_at IS NULL THEN
    SELECT COALESCE(bp.plan_tier, 'free') INTO _tier
    FROM public.brand_profiles bp WHERE bp.id = NEW.brand_id;
    SELECT * INTO _lim FROM public.plan_limits(COALESCE(_tier, 'free'));

    IF _lim.campaign_days IS NOT NULL THEN
      NEW.expires_at := NOW() + (_lim.campaign_days || ' days')::INTERVAL;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS stamp_campaign_expiry ON public.campaigns;
CREATE TRIGGER stamp_campaign_expiry
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.stamp_campaign_expiry();


-- ── The creator cap, folded into the existing gate ───────────────────
-- campaign_lifecycle.sql made this the one question asked before a new
-- creator is invited. The plan's cap is another reason to say no, so it
-- goes here rather than into a second check that could disagree.
CREATE OR REPLACE FUNCTION public.campaign_accepts_new_creators(p_campaign_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.campaigns c
    JOIN public.campaign_escrow e ON e.campaign_id = c.id
    -- LEFT, not inner. brand_profiles rows are created lazily by onboarding,
    -- not by the signup trigger, so a brand can own a campaign before the
    -- row exists. An inner join does not give such a brand a NULL plan_tier
    -- for the COALESCE to catch — it drops the campaign from the result
    -- entirely, EXISTS returns false, and a fully funded campaign refuses
    -- every new creator for a reason nobody can see.
    --
    -- test_money_paths.sql 13d caught this: campaign_capacity() below
    -- already LEFT JOINs, so the two functions answering the same question
    -- disagreed, one reporting the campaign open while the gate refused it.
    LEFT JOIN public.brand_profiles bp ON bp.id = c.brand_id
    CROSS JOIN LATERAL public.plan_limits(COALESCE(bp.plan_tier, 'free')) lim
    WHERE c.id = p_campaign_id
      AND c.status = 'active'
      AND e.closed_at IS NULL
      AND e.balance >= 500
      AND (c.expires_at IS NULL OR c.expires_at > NOW())
      AND (
        lim.max_creators_per_campaign IS NULL
        OR (SELECT COUNT(DISTINCT al.creator_id)
            FROM public.affiliate_links al
            WHERE al.campaign_id = c.id) < lim.max_creators_per_campaign
      )
  );
$fn$;

REVOKE EXECUTE ON FUNCTION public.campaign_accepts_new_creators(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.campaign_accepts_new_creators(UUID) TO authenticated, service_role;


-- Why a campaign is refusing new creators, for the admin approving them.
-- The boolean above is the gate; this is the sentence to show a human.
CREATE OR REPLACE FUNCTION public.campaign_capacity(p_campaign_id UUID)
RETURNS TABLE (
  accepts_new   BOOLEAN,
  creators_used INT,
  max_creators  INT,
  expires_at    TIMESTAMPTZ,
  reason        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
DECLARE
  _c    RECORD;
  _lim  RECORD;
  _used INT;
BEGIN
  SELECT c.status, c.expires_at, c.title, e.balance, e.closed_at,
         COALESCE(bp.plan_tier, 'free') AS tier
    INTO _c
  FROM public.campaigns c
  JOIN public.campaign_escrow e ON e.campaign_id = c.id
  LEFT JOIN public.brand_profiles bp ON bp.id = c.brand_id
  WHERE c.id = p_campaign_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, NULL::INT, NULL::TIMESTAMPTZ,
      'That campaign has no escrow account.'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO _lim FROM public.plan_limits(_c.tier);

  SELECT COUNT(DISTINCT al.creator_id)::INT INTO _used
  FROM public.affiliate_links al WHERE al.campaign_id = p_campaign_id;

  RETURN QUERY SELECT
    public.campaign_accepts_new_creators(p_campaign_id),
    _used,
    _lim.max_creators_per_campaign,
    _c.expires_at,
    -- Ordered by what the brand would have to do about it, most
    -- actionable first.
    CASE
      WHEN _c.closed_at IS NOT NULL THEN 'The campaign is closed.'
      WHEN _c.status = 'closed'     THEN 'The campaign is closed.'
      WHEN _c.expires_at IS NOT NULL AND _c.expires_at <= NOW()
        THEN format('The free plan''s 30 days ran out on %s. Upgrade to keep it running.',
                    to_char(_c.expires_at, 'DD Mon YYYY'))
      WHEN _c.balance < 500
        THEN format('Balance is R%s, under the R500 floor. Creators already on it keep earning.',
                    ROUND(_c.balance, 2))
      WHEN _c.status <> 'active'    THEN format('The campaign is %s.', _c.status)
      WHEN _lim.max_creators_per_campaign IS NOT NULL
       AND _used >= _lim.max_creators_per_campaign
        THEN format('All %s creator slots on the free plan are taken. Upgrade for more.',
                    _lim.max_creators_per_campaign)
      ELSE NULL
    END;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.campaign_capacity(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.campaign_capacity(UUID) TO authenticated, service_role;


-- ── Expiry sweep ─────────────────────────────────────────────────────
-- Closes free campaigns whose 30 days are up, through close_campaign()
-- so the balance is reconciled and held commissions are released rather
-- than stranded. A campaign that still owes creators money is closed the
-- same way as any other: close_campaign() keeps what is committed and
-- only frees what is spare.
CREATE OR REPLACE FUNCTION public.close_expired_campaigns()
RETURNS TABLE (closed_count INT, refundable_total NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _c    RECORD;
  _res  RECORD;
  _n    INT := 0;
  _sum  NUMERIC := 0;
BEGIN
  FOR _c IN
    SELECT c.id, c.title, c.brand_id
    FROM public.campaigns c
    JOIN public.campaign_escrow e ON e.campaign_id = c.id
    WHERE c.expires_at IS NOT NULL
      AND c.expires_at <= NOW()
      AND c.status <> 'closed'
      AND e.closed_at IS NULL
  LOOP
    SELECT * INTO _res FROM public.close_campaign(_c.id);

    IF _res.closed THEN
      _n   := _n + 1;
      _sum := _sum + COALESCE(_res.refundable, 0);

      PERFORM public.enqueue_email(
        (SELECT p.email FROM public.profiles p WHERE p.id = _c.brand_id),
        format('"%s" has finished its 30 days', _c.title),
        format(
          'Hi,' || chr(10) || chr(10) ||
          '"%s" has reached the end of the 30 days the free plan covers, so it is now closed.' || chr(10) || chr(10) ||
          'R%s of your deposit is unspent. R%s is still committed to creators whose ' ||
          'commissions are inside their return window — that is paid out as it clears.' || chr(10) || chr(10) ||
          'Get in touch and we will arrange the unspent balance, either back to you or ' ||
          'against your next campaign.' || chr(10) || chr(10) ||
          'COVO',
          _c.title, ROUND(COALESCE(_res.refundable, 0), 2),
          ROUND(COALESCE(_res.still_committed, 0), 2)
        ),
        'campaign_expired',
        _c.id
      );
    END IF;
  END LOOP;

  RETURN QUERY SELECT _n, _sum;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.close_expired_campaigns() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.close_expired_campaigns() TO service_role;


DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('covo-close-expired-campaigns')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'covo-close-expired-campaigns');
    PERFORM cron.schedule('covo-close-expired-campaigns', '30 7 * * *',
      $job$ SELECT public.close_expired_campaigns(); $job$);
    RAISE NOTICE 'Scheduled: expired free campaigns close daily at 07:30 UTC.';
  ELSE
    RAISE WARNING 'pg_cron is not installed — close_expired_campaigns() must be run by hand.';
  END IF;
END;
$do$;


-- ── Verify ───────────────────────────────────────────────────────────
DO $do$
DECLARE _brands INT; _over INT; _nostamp INT;
BEGIN
  SELECT COUNT(*) INTO _brands FROM public.brand_profiles WHERE plan_tier = 'free';

  SELECT COUNT(*) INTO _over FROM (
    SELECT c.brand_id FROM public.campaigns c
    JOIN public.brand_profiles bp ON bp.id = c.brand_id
    WHERE bp.plan_tier = 'free' AND c.status <> 'closed'
    GROUP BY c.brand_id HAVING COUNT(*) > 1
  ) x;

  SELECT COUNT(*) INTO _nostamp FROM public.campaigns
   WHERE status = 'active' AND expires_at IS NULL;

  RAISE NOTICE '% brand(s) on the free tier.', _brands;

  -- Existing campaigns are left exactly as they are. The trigger fires
  -- on INSERT, so nothing already running is closed or expired by this
  -- file — a brand that is over the limit today keeps what it has and is
  -- only stopped from adding more.
  IF _over > 0 THEN
    RAISE NOTICE '% free-tier brand(s) already have more than one open campaign. Left alone; they cannot add another.', _over;
  END IF;

  IF _nostamp > 0 THEN
    RAISE NOTICE '% active campaign(s) have no expiry and will not be swept. Set expires_at by hand to put one on the clock.', _nostamp;
  END IF;
END;
$do$;
