-- ════════════════════════════════════════════════════════════════════
-- COVO — verify the privilege guards actually fire
--
-- security_hardening.sql is only worth anything if the triggers reject a
-- browser's write and let the platform's own writes through. Those two
-- halves fail in opposite directions and neither is visible by reading
-- the schema, so prove both.
--
-- Run in the Supabase SQL Editor AFTER security_hardening.sql. Read-only:
-- everything happens inside a transaction that is rolled back.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

DO $verify$
DECLARE
  _uid    UUID;
  _failed TEXT[] := '{}';
  _passed INT := 0;
BEGIN
  -- Each check below sets request.jwt.claims and SET LOCAL ROLE
  -- authenticated, which is exactly how a PATCH from the browser reaches
  -- Postgres: auth.uid() resolves from the claim, RLS applies, and the
  -- guard triggers see current_user = 'authenticated'.
  SELECT id INTO _uid FROM public.profiles WHERE role = 'creator' LIMIT 1;
  IF _uid IS NULL THEN
    RAISE NOTICE 'No creator profile to test against — sign one up first.';
    RETURN;
  END IF;

  RAISE NOTICE 'Testing against creator %', _uid;

  -- ── 1. A creator must not be able to promote themselves ───────────
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    UPDATE public.profiles SET role = 'admin' WHERE id = _uid;

    RESET ROLE;
    _failed := _failed || 'profiles.role: a creator CAN still make themselves an admin';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    _passed := _passed + 1;
  WHEN OTHERS THEN
    RESET ROLE;
    _failed := _failed || ('profiles.role: unexpected error — ' || SQLERRM);
  END;

  -- ── 2. A creator must not be able to set their own score ──────────
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    UPDATE public.creator_profiles SET covo_score = 100 WHERE id = _uid;

    RESET ROLE;
    _failed := _failed || 'creator_profiles.covo_score: a creator CAN still set their own score';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    _passed := _passed + 1;
  WHEN OTHERS THEN
    RESET ROLE;
    _failed := _failed || ('creator_profiles.covo_score: unexpected error — ' || SQLERRM);
  END;

  -- ── 3. …but an honest recalculation must still get through ────────
  -- This is the half that a SECURITY DEFINER guard would break: the
  -- score would become unwritable by anything, including COVO itself.
  BEGIN
    PERFORM public.refresh_covo_score(_uid);
    _passed := _passed + 1;
  EXCEPTION WHEN OTHERS THEN
    _failed := _failed || ('refresh_covo_score is blocked by its own guard — ' || SQLERRM);
  END;

  -- ── 4. A brand must not be able to publish its own campaign ───────
  DECLARE
    _brand    UUID;
    _campaign UUID;
  BEGIN
    SELECT c.id, c.brand_id INTO _campaign, _brand
    FROM public.campaigns c WHERE c.status <> 'active' LIMIT 1;

    IF _campaign IS NULL THEN
      RAISE NOTICE '  (4) skipped — no non-active campaign to test with';
    ELSE
      BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', _brand, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;

        UPDATE public.campaigns SET status = 'active' WHERE id = _campaign;

        RESET ROLE;
        _failed := _failed || 'campaigns.status: a brand CAN still publish its own campaign';
      EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        _passed := _passed + 1;
      WHEN OTHERS THEN
        RESET ROLE;
        _failed := _failed || ('campaigns.status: unexpected error — ' || SQLERRM);
      END;
    END IF;
  END;

  -- ── Report ────────────────────────────────────────────────────────
  RAISE NOTICE '';
  IF ARRAY_LENGTH(_failed, 1) IS NULL THEN
    RAISE NOTICE '✓ all % guard checks passed', _passed;
  ELSE
    RAISE NOTICE '✗ % passed, % FAILED:', _passed, ARRAY_LENGTH(_failed, 1);
    FOR i IN 1 .. ARRAY_LENGTH(_failed, 1) LOOP
      RAISE NOTICE '    - %', _failed[i];
    END LOOP;
  END IF;
END;
$verify$;

ROLLBACK;


-- ── Static checks, no transaction needed ─────────────────────────────
-- The guards must be SECURITY INVOKER. A DEFINER guard sees current_user
-- as its own owner on every write, so is_direct_client_write() reads
-- false even for a browser and every check above silently passes through.
SELECT p.proname AS guard,
       CASE WHEN p.prosecdef THEN '✗ SECURITY DEFINER — guard will never fire'
            ELSE '✓ SECURITY INVOKER' END AS verdict
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('guard_profile_privileges',
                    'guard_creator_profile_privileges',
                    'guard_campaign_status')
ORDER BY p.proname;

-- The shop registry must have RLS on and no policies at all, or a brand's
-- own session could read the secret that signs its webhooks.
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       COUNT(pol.polname) AS policy_count,
       CASE WHEN c.relrowsecurity AND COUNT(pol.polname) = 0
            THEN '✓ service_role only'
            ELSE '✗ webhook_secret is reachable from a browser session' END AS verdict
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy pol ON pol.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relname = 'shopify_shops'
GROUP BY c.relname, c.relrowsecurity;
