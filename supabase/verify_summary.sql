-- ── One row. Nothing to transcribe, nothing to miscount. ─────────────
-- Counting rows off a screen is its own failure mode, so this collapses
-- verify_checks.sql to a single verdict plus the name of anything wrong.
WITH fns AS (
  SELECT x.fn, (p.oid IS NOT NULL) AS ok
  FROM (VALUES ('release_held_commissions'),('confirm_due_commissions'),
               ('run_commission_cycle'),('record_shopify_conversion'),
               ('apply_shopify_refund'),('request_creator_payout')) AS x(fn)
  LEFT JOIN pg_proc p ON p.proname = x.fn AND p.pronamespace = 'public'::regnamespace
),
cols AS (
  SELECT x.col, (c.column_name IS NOT NULL) AS ok
  FROM (VALUES ('niches'),('gender'),('location'),
               ('primary_handle'),('guardrail_acknowledged_at')) AS x(col)
  LEFT JOIN information_schema.columns c
    ON c.table_schema='public' AND c.table_name='creator_profiles' AND c.column_name = x.col
)
SELECT
  (SELECT COUNT(*) FROM fns  WHERE ok) || ' of 6' AS functions_present,
  COALESCE((SELECT string_agg(fn, ', ') FROM fns  WHERE NOT ok), 'none') AS functions_missing,
  (SELECT COUNT(*) FROM cols WHERE ok) || ' of 5' AS columns_present,
  COALESCE((SELECT string_agg(col, ', ') FROM cols WHERE NOT ok), 'none') AS columns_missing,
  CASE WHEN (SELECT COUNT(*) FROM fns WHERE NOT ok) = 0
        AND (SELECT COUNT(*) FROM cols WHERE NOT ok) = 0
       THEN 'ALL PRESENT' ELSE 'SOMETHING IS MISSING' END AS verdict;
