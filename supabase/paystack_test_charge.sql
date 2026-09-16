-- ════════════════════════════════════════════════════════════════════
-- COVO — stage a Paystack test deposit
--
-- A charge.success webhook only does anything if there is already a
-- pending escrow_tranches row carrying the same reference. That row is
-- normally created by the brand's "Add funds" flow, which is still
-- disabled pending this integration — so for testing it goes in by hand.
--
-- Fill in the reference from the Paystack transaction you initialised,
-- run this, then pay the checkout link with a test card. The webhook
-- claims this row, credits the escrow, releases anything held and
-- resumes the campaign if the balance clears R500.
--
-- Safe to re-run: a reference is unique, so a second run for the same
-- reference does nothing rather than staging a duplicate deposit.
-- ════════════════════════════════════════════════════════════════════

DO $do$
DECLARE
  -- ── Set these two ────────────────────────────────────────────────
  -- Pre-filled with a transaction that was actually paid in Paystack test
  -- mode on 2026-09-07 (R1 000.00, status success). Using the real
  -- reference rather than an invented one means this exercises the path a
  -- genuine deposit takes, against money that genuinely moved.
  _reference TEXT    := 'COVO-TEST-1788792709';
  _amount    NUMERIC := 1000;   -- rands, matching the charge
  -- ─────────────────────────────────────────────────────────────────
  _escrow    RECORD;
BEGIN
  IF _reference LIKE 'PUT-THE-%' THEN
    RAISE EXCEPTION 'Set _reference to the reference of the Paystack transaction first.';
  END IF;

  -- Most recently created campaign that actually has an escrow account.
  -- A campaign without one cannot take a deposit — escrow rows are
  -- created when an admin approves the campaign.
  SELECT e.id, e.campaign_id, e.brand_id, e.balance, e.status, c.title
    INTO _escrow
  FROM public.campaign_escrow e
  JOIN public.campaigns c ON c.id = e.campaign_id
  ORDER BY e.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No campaign_escrow rows exist. Approve a campaign in the admin panel first — that is what creates the escrow account.';
  END IF;

  INSERT INTO public.escrow_tranches (
    escrow_id, campaign_id, brand_id, amount, paystack_reference, paystack_status
  ) VALUES (
    _escrow.id, _escrow.campaign_id, _escrow.brand_id, _amount, _reference, 'pending'
  )
  ON CONFLICT (paystack_reference) DO NOTHING;

  RAISE NOTICE '─────────────────────────────────────────────';
  RAISE NOTICE 'Staged a pending deposit of R% ', _amount;
  RAISE NOTICE '  campaign : %', _escrow.title;
  RAISE NOTICE '  reference: %', _reference;
  RAISE NOTICE '  balance now: R%  (escrow is %)', _escrow.balance, _escrow.status;
  RAISE NOTICE '';
  RAISE NOTICE 'This reference is already paid on Paystack, so no checkout step';
  RAISE NOTICE 'is needed — the signed charge.success can be delivered straight';
  RAISE NOTICE 'to the webhook. The balance should then rise by R%.', _amount;
  RAISE NOTICE '─────────────────────────────────────────────';
END;
$do$;


-- ── After paying, check it landed ────────────────────────────────────
SELECT t.paystack_reference,
       t.paystack_status,
       t.livemode,
       t.amount        AS staged_amount,
       t.deposited_at,
       e.balance       AS escrow_balance,
       e.total_deposited,
       e.status        AS escrow_status,
       c.title         AS campaign,
       c.status        AS campaign_status
FROM public.escrow_tranches t
JOIN public.campaign_escrow e ON e.id = t.escrow_id
JOIN public.campaigns c       ON c.id = t.campaign_id
ORDER BY t.created_at DESC
LIMIT 5;

-- paystack_status 'success' with livemode = false is the expected result
-- of a test charge. If it is still 'pending', the webhook did not arrive
-- or was refused — check the Edge Function logs and Paystack's own
-- delivery log for the response it got back.
