-- ════════════════════════════════════════════════════════════════════
-- COVO — the creator_profiles columns the app actually uses
--
-- Onboarding.jsx and DashProfile.jsx read and write niches, gender,
-- location, primary_handle and guardrail_acknowledged_at. None of them
-- appeared in any file under supabase/. They exist on the live project
-- because they were added by hand in the SQL Editor and never written
-- down, so supabase/ described a database that no longer existed:
-- provisioning a fresh project from these files produced an app whose
-- creator onboarding failed on the final step with PGRST204.
--
-- Additive and idempotent — safe to run against the live project, where
-- every ADD COLUMN below is already satisfied and does nothing.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.creator_profiles
  -- The onboarding niche picker is multi-select, so this is an array.
  -- schema_full.sql also declares a singular `niche TEXT`, which nothing
  -- renders; it is left in place rather than dropped, because dropping a
  -- column on a live project to tidy a file is not a trade worth making.
  ADD COLUMN IF NOT EXISTS niches                    TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS gender                    TEXT,
  ADD COLUMN IF NOT EXISTS location                  TEXT,
  ADD COLUMN IF NOT EXISTS primary_handle            TEXT,
  -- Separate from the boolean guardrail_acknowledged: the flag gates the
  -- dashboard, the timestamp is the record of when they agreed.
  ADD COLUMN IF NOT EXISTS guardrail_acknowledged_at TIMESTAMPTZ;


-- ── Guard against this drifting again ────────────────────────────────
-- Fails loudly if a column the app depends on is missing, rather than
-- letting onboarding break at runtime for one user at a time.
DO $do$
DECLARE
  _required TEXT[] := ARRAY[
    'niches', 'gender', 'location', 'primary_handle',
    'guardrail_acknowledged', 'guardrail_acknowledged_at',
    'bio', 'covo_score', 'is_verified', 'joined_campaign_ids'
  ];
  _missing TEXT[];
BEGIN
  SELECT ARRAY_AGG(c)
    INTO _missing
  FROM UNNEST(_required) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'creator_profiles'
      AND column_name  = c
  );

  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'creator_profiles is missing columns the app reads: %', _missing;
  END IF;

  RAISE NOTICE 'creator_profiles: all % expected columns present', ARRAY_LENGTH(_required, 1);
END;
$do$;
