-- ── One result set, because the SQL Editor renders only the last ─────
SELECT * FROM (
  -- 1. The guards must be SECURITY INVOKER, or they never fire.
  SELECT 1 AS ord, p.proname::text AS check_name,
         CASE WHEN p.prosecdef THEN 'FAIL' ELSE 'PASS' END AS status,
         CASE WHEN p.prosecdef
              THEN 'SECURITY DEFINER — current_user reads postgres on every write, guard is a no-op'
              ELSE 'SECURITY INVOKER' END AS detail
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('guard_profile_privileges','guard_creator_profile_privileges','guard_campaign_status')

  UNION ALL
  -- 2. A guard that exists but is not attached protects nothing.
  SELECT 2, t.tgname::text,
         CASE WHEN t.tgenabled = 'O' THEN 'PASS' ELSE 'FAIL' END,
         'trigger on ' || c.relname::text || ', tgenabled=' || t.tgenabled::text
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND t.tgname IN ('guard_profile_privileges','guard_creator_profile_privileges','guard_campaign_status')

  UNION ALL
  -- 3. Helpers the guards call.
  SELECT 3, p.proname::text, 'PASS',
         CASE WHEN p.prosecdef THEN 'SECURITY DEFINER (correct here)' ELSE 'SECURITY INVOKER (correct here)' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('is_admin','is_direct_client_write')

  UNION ALL
  -- 4. Money + score functions that must exist for the cron and webhooks.
  SELECT 4, x.fn::text, CASE WHEN p.oid IS NULL THEN 'FAIL' ELSE 'PASS' END,
         CASE WHEN p.oid IS NULL THEN 'MISSING — did that file run?' ELSE 'present' END
  FROM (VALUES ('release_held_commissions'),('confirm_due_commissions'),('run_commission_cycle'),
               ('record_shopify_conversion'),('apply_shopify_refund'),('request_creator_payout')) AS x(fn)
  LEFT JOIN pg_proc p ON p.proname = x.fn
       AND p.pronamespace = 'public'::regnamespace

  UNION ALL
  -- 5. The five columns onboarding writes.
  SELECT 5, ('creator_profiles.' || x.col)::text,
         CASE WHEN c.column_name IS NULL THEN 'FAIL' ELSE 'PASS' END,
         CASE WHEN c.column_name IS NULL THEN 'MISSING — run creator_profile_columns.sql' ELSE c.data_type::text END
  FROM (VALUES ('niches'),('gender'),('location'),('primary_handle'),('guardrail_acknowledged_at')) AS x(col)
  LEFT JOIN information_schema.columns c
         ON c.table_schema='public' AND c.table_name='creator_profiles' AND c.column_name = x.col

  UNION ALL
  -- 6. Secrets table stays unreachable from a browser session.
  SELECT 6, 'shopify_shops lockdown',
         CASE WHEN cl.relrowsecurity AND COUNT(pol.polname)=0 THEN 'PASS' ELSE 'FAIL' END,
         'rls=' || cl.relrowsecurity::text || ', policies=' || COUNT(pol.polname)::text
  FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace
  LEFT JOIN pg_policy pol ON pol.polrelid = cl.oid
  WHERE n.nspname='public' AND cl.relname='shopify_shops'
  GROUP BY cl.relrowsecurity

  UNION ALL
  -- 7. Both nightly jobs scheduled.
  SELECT 7, ('cron: ' || j.jobname)::text, CASE WHEN j.active THEN 'PASS' ELSE 'FAIL' END, j.schedule
  FROM cron.job j WHERE j.jobname LIKE 'covo-%'
) checks
ORDER BY ord, check_name;
