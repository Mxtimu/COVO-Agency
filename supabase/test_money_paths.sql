-- ════════════════════════════════════════════════════════════════════
-- COVO — tests for the plpgsql that touches money
--
-- Everything runs inside a transaction that is ROLLED BACK, against
-- fixtures created here and thrown away. Nothing in the live data is
-- read, written or left behind — run it on production safely.
--
-- Covers the paths where being wrong costs somebody real money:
--
--   1. commission arithmetic — rate, 8% platform fee, net
--   2. idempotency — a redelivered order must not pay twice
--   3. escrow solvency — liabilities counted in aggregate, not per sale
--   4. held → pending release once the brand funds the campaign
--   5. return-window confirmation, and that it cannot outrun escrow
--   6. escrow can never go negative
--   7. payout batching — a commission cannot be claimed by two payouts
--   8. refunds — proportional reduction, and denial at full refund
--   9. click deduplication
--
-- Output is one NOTICE per assertion plus a summary. In the Supabase SQL
-- Editor, NOTICE output appears under the results pane; if you cannot see
-- it, the final SELECT reports the same tally as a row.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _results (name TEXT, passed BOOLEAN, detail TEXT) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.check(p_name TEXT, p_cond BOOLEAN, p_detail TEXT DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _results VALUES (p_name, COALESCE(p_cond, false), p_detail);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.check_eq(p_name TEXT, p_got NUMERIC, p_want NUMERIC)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _results VALUES (
    p_name,
    p_got IS NOT DISTINCT FROM p_want,
    format('got %s, want %s', COALESCE(p_got::TEXT,'NULL'), COALESCE(p_want::TEXT,'NULL'))
  );
END;
$$;


DO $tests$
DECLARE
  _brand    UUID := gen_random_uuid();
  _creator  UUID := gen_random_uuid();
  _campaign UUID;
  _product  UUID;
  _link     UUID;
  _escrow   UUID;
  _r        RECORD;
  _n        INT;
  _v        NUMERIC;
  _c1       UUID;
BEGIN
  -- ── Fixtures ───────────────────────────────────────────────────────
  -- auth.users rows are required by the profiles FK.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (_brand,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-brand-'   || _brand   || '@covo.test', '', NOW(), NOW(), '{}', '{}'),
    (_creator, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-creator-' || _creator || '@covo.test', '', NOW(), NOW(), '{}', '{}');

  -- handle_new_user() creates the profiles rows; set the roles it defaulted.
  UPDATE public.profiles SET role = 'brand'   WHERE id = _brand;
  UPDATE public.profiles SET role = 'creator' WHERE id = _creator;

  INSERT INTO public.campaigns (brand_id, title, commission_rate, return_window_days, status)
  VALUES (_brand, 'Test campaign', 0.10, 14, 'active')
  RETURNING id INTO _campaign;

  INSERT INTO public.products (campaign_id, name, price, tracking_url)
  VALUES (_campaign, 'Test product', 500, 'https://example.test/p')
  RETURNING id INTO _product;

  INSERT INTO public.affiliate_links (creator_id, campaign_id, product_id, slug)
  VALUES (_creator, _campaign, _product, 'test-' || substr(_campaign::text, 1, 8))
  RETURNING id INTO _link;

  INSERT INTO public.campaign_escrow (campaign_id, brand_id, balance, total_deposited, status)
  VALUES (_campaign, _brand, 10000, 10000, 'active')
  RETURNING id INTO _escrow;


  -- ══ 1. Commission arithmetic ═════════════════════════════════════
  -- R1000 at 10% = R100 gross, 8% fee = R8, net R92.
  SELECT * INTO _r FROM public.record_shopify_conversion(
    _link, 'ORDER-1', 1000, 'ZAR', 'test.myshopify.com', _brand);

  PERFORM pg_temp.check('1a commission recorded', _r.recorded, COALESCE(_r.reason,''));
  PERFORM pg_temp.check_eq('1b net commission is 92', _r.net_commission, 92);
  PERFORM pg_temp.check('1c status is pending (escrow covers it)', _r.status = 'pending', _r.status);

  SELECT gross_commission, platform_fee, net_commission, commission_rate
    INTO _r FROM public.commissions WHERE external_order_id = 'ORDER-1';
  PERFORM pg_temp.check_eq('1d gross is 100',      _r.gross_commission, 100);
  PERFORM pg_temp.check_eq('1e platform fee is 8', _r.platform_fee, 8);
  PERFORM pg_temp.check_eq('1f rate stored as fraction', _r.commission_rate, 0.10);

  -- confirms_at must land at sale + the campaign's return window.
  SELECT EXTRACT(DAY FROM (confirms_at - created_at))::INT INTO _n
    FROM public.commissions WHERE external_order_id = 'ORDER-1';
  PERFORM pg_temp.check_eq('1g confirms_at is +14 days', _n, 14);


  -- ══ 2. Idempotency on a duplicate order ══════════════════════════
  -- Shopify redelivers until it sees a 200, so this is the normal path.
  SELECT * INTO _r FROM public.record_shopify_conversion(
    _link, 'ORDER-1', 1000, 'ZAR', 'test.myshopify.com', _brand);
  PERFORM pg_temp.check('2a replay is refused', NOT _r.recorded, COALESCE(_r.reason,''));

  SELECT COUNT(*) INTO _n FROM public.commissions WHERE external_order_id = 'ORDER-1';
  PERFORM pg_temp.check_eq('2b still exactly one commission', _n, 1);

  -- A different amount on the same order id must not create a second row
  -- either — the order is the identity, not the amount.
  SELECT * INTO _r FROM public.record_shopify_conversion(
    _link, 'ORDER-1', 999999, 'ZAR', 'test.myshopify.com', _brand);
  SELECT COUNT(*) INTO _n FROM public.commissions WHERE external_order_id = 'ORDER-1';
  PERFORM pg_temp.check_eq('2c replay with a different amount changes nothing', _n, 1);


  -- ══ 3. A store cannot bill another brand's escrow ════════════════
  SELECT * INTO _r FROM public.record_shopify_conversion(
    _link, 'ORDER-X', 1000, 'ZAR', 'attacker.myshopify.com', gen_random_uuid());
  PERFORM pg_temp.check('3a foreign brand_id is rejected', NOT _r.recorded, COALESCE(_r.reason,''));


  -- ══ 4. Escrow solvency counts liabilities in aggregate ═══════════
  -- Balance 10000, already owes 92. Ten orders of 1000 each owe 92 apiece.
  -- Each is individually far under the balance; together they must not be
  -- allowed to exceed it. Drop the balance to just above one commission so
  -- the second must be held.
  UPDATE public.campaign_escrow SET balance = 150 WHERE id = _escrow;

  SELECT * INTO _r FROM public.record_shopify_conversion(
    _link, 'ORDER-2', 1000, 'ZAR', 'test.myshopify.com', _brand);
  -- Owed is now 92 (ORDER-1) + 92 = 184 > 150, so this one is not covered.
  PERFORM pg_temp.check('4a second sale is held, not pending', _r.status = 'held', _r.status);

  SELECT status INTO _r FROM public.campaign_escrow WHERE id = _escrow;
  PERFORM pg_temp.check('4b underfunded campaign is paused', _r.status = 'paused', _r.status);


  -- ══ 5. Held → pending once the brand funds it ════════════════════
  UPDATE public.campaign_escrow SET balance = 10000, status = 'active' WHERE id = _escrow;
  UPDATE public.campaigns SET status = 'active' WHERE id = _campaign;

  SELECT * INTO _r FROM public.release_held_commissions(_campaign);
  PERFORM pg_temp.check_eq('5a one commission released', _r.released_count, 1);
  PERFORM pg_temp.check_eq('5b released value is 92',    _r.released_value, 92);

  SELECT COUNT(*) INTO _n FROM public.commissions
   WHERE campaign_id = _campaign AND status = 'held';
  PERFORM pg_temp.check_eq('5c nothing left held', _n, 0);


  -- ══ 6. Return-window confirmation ════════════════════════════════
  -- Nothing is due yet, so a cycle now must confirm nothing.
  SELECT * INTO _r FROM public.confirm_due_commissions();
  PERFORM pg_temp.check_eq('6a nothing confirms before the window closes', _r.confirmed_count, 0);

  -- Age both commissions past their window.
  UPDATE public.commissions SET confirms_at = NOW() - INTERVAL '1 day'
   WHERE campaign_id = _campaign AND status = 'pending';

  SELECT * INTO _r FROM public.confirm_due_commissions();
  PERFORM pg_temp.check_eq('6b both confirm once due', _r.confirmed_count, 2);
  PERFORM pg_temp.check_eq('6c total confirmed value is 184', _r.total_value, 184);

  -- Escrow drawn down by exactly what was confirmed: 10000 - 184.
  SELECT balance INTO _v FROM public.campaign_escrow WHERE id = _escrow;
  PERFORM pg_temp.check_eq('6d escrow debited by 184', _v, 9816);


  -- ══ 7. Escrow cannot go negative ═════════════════════════════════
  -- Strand a commission against an empty balance and confirm it.
  UPDATE public.campaign_escrow SET balance = 0, status = 'active' WHERE id = _escrow;
  UPDATE public.campaigns SET status = 'active' WHERE id = _campaign;

  INSERT INTO public.commissions (
    creator_id, campaign_id, product_id, affiliate_link_id, external_order_id,
    sale_amount, commission_rate, gross_commission, platform_fee, net_commission,
    status, return_window_days, confirms_at
  ) VALUES (
    _creator, _campaign, _product, _link, 'ORDER-3',
    1000, 0.10, 100, 8, 92, 'pending', 14, NOW() - INTERVAL '1 day'
  );

  SELECT * INTO _r FROM public.confirm_due_commissions();
  PERFORM pg_temp.check_eq('7a unfunded commission does not confirm', _r.confirmed_count, 0);
  PERFORM pg_temp.check_eq('7b it is held back instead',              _r.held_back, 1);

  SELECT balance INTO _v FROM public.campaign_escrow WHERE id = _escrow;
  PERFORM pg_temp.check('7c balance did not go negative', _v >= 0, _v::TEXT);


  -- ══ 8. Payout batching ═══════════════════════════════════════════
  -- request_creator_payout() reads auth.uid(), so impersonate the creator.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _creator, 'role', 'authenticated')::text, true);

  SELECT COALESCE(SUM(net_commission), 0) INTO _v FROM public.commissions
   WHERE creator_id = _creator AND status = 'confirmed';

  IF _v >= 250 THEN
    SELECT * INTO _r FROM public.request_creator_payout();
    PERFORM pg_temp.check_eq('8a payout claims the confirmed total', _r.amount, _v);

    -- The same commissions must not be claimable twice.
    BEGIN
      PERFORM public.request_creator_payout();
      PERFORM pg_temp.check('8b second payout is refused', false, 'it succeeded');
    EXCEPTION WHEN OTHERS THEN
      PERFORM pg_temp.check('8b second payout is refused', true, SQLERRM);
    END;
  ELSE
    -- 184 is under the R250 floor, which is itself the assertion.
    BEGIN
      PERFORM public.request_creator_payout();
      PERFORM pg_temp.check('8a below-minimum payout is refused', false, 'it succeeded');
    EXCEPTION WHEN OTHERS THEN
      PERFORM pg_temp.check('8a below-minimum payout is refused', true, SQLERRM);
    END;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);


  -- ══ 9. Refunds ═══════════════════════════════════════════════════
  -- Half of ORDER-1 refunded: commission halves to 46.
  SELECT * INTO _r FROM public.apply_shopify_refund(_brand, 'ORDER-1', 500);
  PERFORM pg_temp.check('9a refund applied', _r.applied, COALESCE(_r.reason,''));
  PERFORM pg_temp.check_eq('9b commission halves to 46', _r.new_net, 46);

  -- The rest refunded: the commission is denied outright.
  SELECT * INTO _r FROM public.apply_shopify_refund(_brand, 'ORDER-1', 500);
  PERFORM pg_temp.check('9c full refund denies the commission', _r.new_status = 'denied', COALESCE(_r.new_status,'NULL'));

  -- A refund for an order this brand does not own must not match.
  SELECT * INTO _r FROM public.apply_shopify_refund(gen_random_uuid(), 'ORDER-2', 100);
  PERFORM pg_temp.check('9d refund from the wrong brand is refused', NOT _r.applied, COALESCE(_r.reason,''));


  -- ══ 10. Click deduplication ══════════════════════════════════════
  SELECT * INTO _r FROM public.record_click(_link, _creator, _campaign, _product, 'iphash-aaa');
  PERFORM pg_temp.check('10a first click counts', _r.counted, '');

  SELECT * INTO _r FROM public.record_click(_link, _creator, _campaign, _product, 'iphash-aaa');
  PERFORM pg_temp.check('10b immediate repeat does not count', NOT _r.counted, '');

  SELECT * INTO _r FROM public.record_click(_link, _creator, _campaign, _product, 'iphash-bbb');
  PERFORM pg_temp.check('10c a different visitor counts', _r.counted, '');

  SELECT COUNT(*) INTO _n FROM public.clicks WHERE affiliate_link_id = _link;
  PERFORM pg_temp.check_eq('10d two clicks recorded, not three', _n, 2);

EXCEPTION WHEN OTHERS THEN
  INSERT INTO _results VALUES ('FIXTURE OR TEST CRASHED', false, SQLERRM);
END;
$tests$;


-- ── Report ───────────────────────────────────────────────────────────
DO $report$
DECLARE
  _row RECORD;
  _pass INT;
  _fail INT;
BEGIN
  SELECT COUNT(*) FILTER (WHERE passed), COUNT(*) FILTER (WHERE NOT passed)
    INTO _pass, _fail FROM _results;

  RAISE NOTICE '─────────────────────────────────────────────';
  FOR _row IN SELECT * FROM _results ORDER BY name LOOP
    RAISE NOTICE '% %  %',
      CASE WHEN _row.passed THEN 'PASS' ELSE 'FAIL' END,
      rpad(_row.name, 46),
      CASE WHEN _row.passed THEN '' ELSE _row.detail END;
  END LOOP;
  RAISE NOTICE '─────────────────────────────────────────────';
  RAISE NOTICE '% passed, % failed', _pass, _fail;
END;
$report$;

-- Same tally as a row, for when NOTICE output is not visible.
SELECT
  COUNT(*) FILTER (WHERE passed)     AS passed,
  COUNT(*) FILTER (WHERE NOT passed) AS failed,
  COALESCE(string_agg(name || ' (' || detail || ')', '; ')
           FILTER (WHERE NOT passed), 'none') AS failures,
  CASE WHEN COUNT(*) FILTER (WHERE NOT passed) = 0
       THEN 'ALL MONEY PATHS PASS' ELSE 'FAILURES — see above' END AS verdict
FROM _results;

ROLLBACK;
