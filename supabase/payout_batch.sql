-- ════════════════════════════════════════════════════════════════════
-- COVO — the monthly payout cycle
--
-- Payouts existed but only one creator at a time, started by hand in the
-- admin panel. That does not scale past a few dozen creators, and it
-- makes payday depend on somebody remembering. This runs the whole cycle
-- in one transaction, once a month.
--
-- THE MINIMUM IS NOW R200, DOWN FROM R250.
--
--   R250 was hardcoded in three places. min_payout() now holds it once,
--   defined in creator_payouts.sql because that is the earliest file
--   that needs it; the other two call sites were edited in place rather
--   than redefined here. Redefining a function in a second file is how
--   abandon_payout ended up with two bodies and a run order that
--   silently reinstated the broken one — not a mistake worth repeating.
--
-- ROLLOVER IS NOT A TRANSFER OF MONEY, IT IS THE ABSENCE OF ONE.
--
--   A creator under the minimum is skipped and their commissions are left
--   confirmed and unclaimed, so next month's run picks them up together
--   with the new ones. Nothing moves and no balance is adjusted — that is
--   what makes it safe. What was missing was any way for the creator to
--   SEE it: the dashboard showed an amount it would not pay and gave no
--   reason. creator_payout_standing() is that explanation.
--
-- 'paid' is spelled 'success' in the payouts table, which is Paystack's
-- own vocabulary for a settled transfer and is already load-bearing in
-- claim_payout_for_transfer and mark_payout_settled. Renaming it to match
-- the ticket would mean rewriting the state machine around the money for
-- a synonym, so the word stays and this note explains it.
--
-- Run AFTER email_outbox.sql — the batch enqueues mail.
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.payout_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The first of the month being paid for. UNIQUE is the whole
  -- safeguard: a cron that fires twice, or an admin who clicks Run
  -- again, must not create a second month's worth of transfers.
  period          DATE NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','closed')),
  payouts_created INT NOT NULL DEFAULT 0,
  total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  creators_rolled INT NOT NULL DEFAULT 0,
  rolled_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  run_by          UUID REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read batches" ON public.payout_batches;
CREATE POLICY "admins read batches" ON public.payout_batches
  FOR SELECT USING (public.is_admin());

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.payout_batches(id);

CREATE INDEX IF NOT EXISTS payouts_batch ON public.payouts (batch_id);


-- ── What a creator is owed, and why it has not been paid ─────────────
CREATE OR REPLACE FUNCTION public.creator_payout_standing(p_creator UUID DEFAULT NULL)
RETURNS TABLE (
  creator_id        UUID,
  unclaimed         NUMERIC,
  commission_count  INT,
  minimum           NUMERIC,
  shortfall         NUMERIC,
  payable           BOOLEAN,
  explanation       TEXT
)
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
  WITH who AS (
    SELECT COALESCE(p_creator, auth.uid()) AS id
  ), owed AS (
    SELECT w.id,
           COALESCE(SUM(c.net_commission), 0) AS unclaimed,
           COUNT(c.id)::INT                   AS n
    FROM who w
    LEFT JOIN public.commissions c
      ON c.creator_id = w.id
     AND c.status = 'confirmed'
     AND NOT EXISTS (
       SELECT 1 FROM public.payouts p
       WHERE p.creator_id = w.id
         AND p.status IN ('pending', 'processing', 'success')
         AND c.id = ANY(p.commission_ids)
     )
    GROUP BY w.id
  )
  SELECT o.id,
         o.unclaimed,
         o.n,
         public.min_payout(),
         GREATEST(0, public.min_payout() - o.unclaimed),
         o.unclaimed >= public.min_payout(),
         CASE
           WHEN o.unclaimed >= public.min_payout()
             THEN 'Due in the next monthly payout run.'
           WHEN o.unclaimed > 0
             THEN format('R%s more in confirmed earnings and this goes out in the next monthly run. Until then it carries over — nothing is lost.',
                         ROUND(public.min_payout() - o.unclaimed, 2))
           ELSE 'No confirmed earnings waiting yet.'
         END
  FROM owed o
  WHERE o.id = auth.uid() OR public.can_act_as_admin();
$fn$;

REVOKE EXECUTE ON FUNCTION public.creator_payout_standing(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.creator_payout_standing(UUID) TO authenticated, service_role;


-- ── The monthly run ──────────────────────────────────────────────────
-- Creates one pending payout per eligible creator and queues each
-- creator's email, in a single transaction. It deliberately does NOT
-- call Paystack: the transfers are picked up afterwards by
-- claim_payout_for_transfer, which already handles claiming,
-- failure and the OTP case. Keeping the batch out of the network means
-- a Paystack outage mid-run cannot leave half a month's payouts in an
-- unknown state.
CREATE OR REPLACE FUNCTION public.run_monthly_payout_batch(
  p_period DATE DEFAULT date_trunc('month', NOW())::DATE
)
RETURNS TABLE (
  batch_id        UUID,
  period          DATE,
  payouts_created INT,
  total_amount    NUMERIC,
  creators_rolled INT,
  rolled_amount   NUMERIC,
  outcome         TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _batch   UUID;
  _period  DATE := date_trunc('month', p_period)::DATE;
  _row     RECORD;
  _payout  UUID;
  _n       INT := 0;
  _total   NUMERIC := 0;
  _rolled  INT := 0;
  _rollamt NUMERIC := 0;
  _min     NUMERIC := public.min_payout();
  _ready   RECORD;
BEGIN
  IF NOT public.can_act_as_admin() THEN
    RAISE EXCEPTION 'Only an administrator may run the payout batch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  BEGIN
    INSERT INTO public.payout_batches (period, run_by)
    VALUES (_period, auth.uid())
    RETURNING id INTO _batch;
  EXCEPTION WHEN unique_violation THEN
    SELECT b.id INTO _batch FROM public.payout_batches b WHERE b.period = _period;
    RETURN QUERY SELECT _batch, _period, 0, 0::NUMERIC, 0, 0::NUMERIC,
      format('The %s cycle has already been run.', to_char(_period, 'FMMonth YYYY'))::TEXT;
    RETURN;
  END;

  FOR _row IN
    SELECT c.creator_id,
           SUM(c.net_commission)      AS owed,
           ARRAY_AGG(c.id)            AS ids
    FROM public.commissions c
    WHERE c.status = 'confirmed'
      AND NOT EXISTS (
        SELECT 1 FROM public.payouts p
        WHERE p.creator_id = c.creator_id
          AND p.status IN ('pending', 'processing', 'success')
          AND c.id = ANY(p.commission_ids)
      )
    GROUP BY c.creator_id
  LOOP
    -- Under the minimum: skip it and leave the commissions alone. They
    -- stay confirmed and unclaimed, so next month's run sees them again.
    IF _row.owed < _min THEN
      _rolled  := _rolled + 1;
      _rollamt := _rollamt + _row.owed;
      CONTINUE;
    END IF;

    -- Bank details and a name that matches them. A creator who never
    -- finished Payout Details cannot be transferred to, and rolling them
    -- over is the honest outcome — the money stays theirs and waits.
    SELECT * INTO _ready FROM public.payout_readiness(_row.creator_id);

    -- payout_readiness() returns no single "ready" flag; these are the
    -- two that block a transfer. has_recipient means Paystack has the
    -- account on file, name_matches means the account holder's name
    -- agrees with the creator's legal name — Paystack rejects a transfer
    -- where it does not, and a rejected transfer costs a fee.
    IF NOT (COALESCE(_ready.has_recipient, false)
            AND COALESCE(_ready.name_matches, false)) THEN
      _rolled  := _rolled + 1;
      _rollamt := _rollamt + _row.owed;
      CONTINUE;
    END IF;

    INSERT INTO public.payouts (creator_id, amount, status, commission_ids,
                                initiated_by, batch_id)
    VALUES (_row.creator_id, _row.owed, 'pending', _row.ids, auth.uid(), _batch)
    RETURNING id INTO _payout;

    _n     := _n + 1;
    _total := _total + _row.owed;

    PERFORM public.enqueue_payout_email(_payout);
  END LOOP;

  UPDATE public.payout_batches
  SET status = 'closed', payouts_created = _n, total_amount = _total,
      creators_rolled = _rolled, rolled_amount = _rollamt
  WHERE id = _batch;

  RETURN QUERY SELECT _batch, _period, _n, _total, _rolled, _rollamt, NULL::TEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.run_monthly_payout_batch(DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.run_monthly_payout_batch(DATE) TO authenticated, service_role;


-- ── The "earnings sent to your bank account" email ───────────────────
-- Queued when the payout is created, not when Paystack settles it,
-- because the creator's question is "is it coming?" and the answer is
-- yes the moment the payout exists. mark_payout_settled sends the
-- second one.
CREATE OR REPLACE FUNCTION public.enqueue_payout_email(p_payout_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _p    RECORD;
  _bank TEXT;
BEGIN
  SELECT pay.id, pay.amount, pay.creator_id,
         pr.email, pr.full_name,
         cp.bank_name, cp.bank_account_last4,
         COALESCE(ARRAY_LENGTH(pay.commission_ids, 1), 0) AS n
    INTO _p
  FROM public.payouts pay
  JOIN public.profiles pr          ON pr.id = pay.creator_id
  LEFT JOIN public.creator_profiles cp ON cp.id = pay.creator_id
  WHERE pay.id = p_payout_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  -- "your Capitec account ending 4821" when the details are there, and a
  -- plain "your bank account" when they are not. Naming a bank COVO is
  -- not certain of would be worse than saying nothing.
  _bank := CASE
    WHEN _p.bank_name IS NOT NULL AND _p.bank_account_last4 IS NOT NULL
      THEN format('your %s account ending %s', _p.bank_name, _p.bank_account_last4)
    WHEN _p.bank_name IS NOT NULL
      THEN format('your %s account', _p.bank_name)
    ELSE 'your bank account'
  END;

  RETURN public.enqueue_email(
    _p.email,
    format('Your COVO earnings of R%s are on the way', ROUND(_p.amount, 2)),
    format(
      'Hi %s,' || chr(10) || chr(10) ||
      'Your earnings of R%s have been sent to %s.' || chr(10) || chr(10) ||
      'That covers %s confirmed commission(s). Bank transfers in South Africa ' ||
      'usually clear within 1-3 business days.' || chr(10) || chr(10) ||
      'You can see the full breakdown under Earnings in your COVO dashboard.' || chr(10) || chr(10) ||
      'If anything looks wrong, reply to this email and we will look into it.' || chr(10) || chr(10) ||
      'COVO',
      COALESCE(NULLIF(TRIM(_p.full_name), ''), 'there'),
      ROUND(_p.amount, 2), _bank, _p.n
    ),
    'payout_sent',
    _p.id
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.enqueue_payout_email(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enqueue_payout_email(UUID) TO service_role;


-- ── Failure, said out loud ───────────────────────────────────────────
-- A failed transfer used to be visible only in the admin panel. The
-- creator was told their money was coming and then heard nothing.
CREATE OR REPLACE FUNCTION public.enqueue_payout_failure_email(p_payout_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _p RECORD;
BEGIN
  SELECT pay.id, pay.amount, pr.email, pr.full_name
    INTO _p
  FROM public.payouts pay
  JOIN public.profiles pr ON pr.id = pay.creator_id
  WHERE pay.id = p_payout_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN public.enqueue_email(
    _p.email,
    'We could not complete your COVO payout',
    format(
      'Hi %s,' || chr(10) || chr(10) ||
      'We tried to send your earnings of R%s and the transfer did not go through. ' ||
      'The money is still yours — it has gone back into your available balance and ' ||
      'will be included in the next payout run.' || chr(10) || chr(10) ||
      'The usual cause is bank details that do not match the account holder''s name. ' ||
      'Please check Payout Details in your dashboard.' || chr(10) || chr(10) ||
      'COVO',
      COALESCE(NULLIF(TRIM(_p.full_name), ''), 'there'), ROUND(_p.amount, 2)
    ),
    'payout_failed',
    _p.id
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.enqueue_payout_failure_email(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enqueue_payout_failure_email(UUID) TO service_role;


-- ── Low-balance mail for brands, from campaign_lifecycle.sql ─────────
-- claim_low_balance_alerts() claims the campaigns; this turns each into
-- a queued message. Split so the claiming stays testable without
-- generating mail.
CREATE OR REPLACE FUNCTION public.enqueue_low_balance_emails()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _a RECORD;
  _n INT := 0;
BEGIN
  FOR _a IN SELECT * FROM public.claim_low_balance_alerts() LOOP
    IF public.enqueue_email(
      _a.brand_email,
      CASE WHEN _a.health = 'below_floor'
        THEN format('"%s" has paused — it is below the R500 funding floor', _a.campaign_title)
        ELSE format('"%s" is running low on funds', _a.campaign_title)
      END,
      format(
        'Hi,' || chr(10) || chr(10) ||
        '"%s" has R%s left in escrow (%s%% of what you have deposited).' || chr(10) || chr(10) ||
        '%s' || chr(10) || chr(10) ||
        'Top up under Payments in your COVO dashboard to keep it running.' || chr(10) || chr(10) ||
        'COVO',
        _a.campaign_title, ROUND(_a.balance, 2), _a.pct_remaining,
        CASE WHEN _a.health = 'below_floor'
          THEN 'The campaign has been paused, so no new creators can be invited to it. '
            || 'Creators already promoting it keep earning, and any sales made while '
            || 'the balance is short are recorded and paid as soon as you top up.'
          ELSE 'Nothing has stopped yet. Below R500 the campaign pauses to new '
            || 'creators, so topping up before then avoids the interruption.'
        END
      ),
      'campaign_low_balance',
      _a.campaign_id
    ) IS NOT NULL THEN
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.enqueue_low_balance_emails() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enqueue_low_balance_emails() TO service_role;


-- ── Schedule ─────────────────────────────────────────────────────────
-- The 1st at 06:00 UTC (08:00 SAST): the month being paid for has closed,
-- and it lands in working hours so a failure is noticed the same day.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('covo-monthly-payout-batch')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'covo-monthly-payout-batch');
    PERFORM cron.schedule('covo-monthly-payout-batch', '0 6 1 * *',
      $job$ SELECT public.run_monthly_payout_batch(); $job$);

    PERFORM cron.unschedule('covo-low-balance-alerts')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'covo-low-balance-alerts');
    PERFORM cron.schedule('covo-low-balance-alerts', '0 7 * * *',
      $job$ SELECT public.enqueue_low_balance_emails(); $job$);

    RAISE NOTICE 'Scheduled: monthly payout batch (1st, 06:00 UTC) and daily low-balance alerts (07:00 UTC).';
  ELSE
    RAISE WARNING 'pg_cron is not installed — run_monthly_payout_batch() must be run by hand.';
  END IF;
END;
$do$;


DO $do$
DECLARE _due INT; _roll INT;
BEGIN
  SELECT COUNT(*) FILTER (WHERE s.payable),
         COUNT(*) FILTER (WHERE NOT s.payable AND s.unclaimed > 0)
    INTO _due, _roll
  FROM (SELECT DISTINCT creator_id FROM public.commissions
         WHERE status = 'confirmed') c
  CROSS JOIN LATERAL public.creator_payout_standing(c.creator_id) s;

  RAISE NOTICE 'Minimum payout is now R%.', public.min_payout();
  RAISE NOTICE 'Next run would pay % creator(s); % would roll over.', _due, _roll;
END;
$do$;
