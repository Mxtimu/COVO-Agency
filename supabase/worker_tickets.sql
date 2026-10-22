-- ════════════════════════════════════════════════════════════════════
-- COVO — letting the database prove it called the worker,
--        without a shared secret anybody has to copy
--
-- The previous design had one random string living in two places: a
-- CRON_SECRET Edge Function env var, and a matching Vault secret that
-- pg_cron read and sent as a header. If the two ever differed, every run
-- got a 401 and mail silently stopped.
--
-- They differed three times in a row. First a freshly generated string
-- that did not match the one already saved; then the literal placeholder
-- text '<same 48 chars>' (15 characters); then the UUID that
-- create_secret() returns, pasted back in as the value (36 characters).
--
-- Every one of those is the same failure: the design made a human
-- responsible for keeping two copies of a long random string in sync
-- across two systems, neither of which will show you what the other
-- holds. A person doing that at the end of a long day gets it wrong, and
-- the only symptom is silence.
--
-- THE FIX: there is nothing to keep in sync.
--
--   The database mints a single-use ticket, hands it to the worker as a
--   header, and the worker redeems it back through the database. Holding
--   a valid unused ticket IS the proof of authority, because only
--   something with service-role write access to this table could have
--   created one — and the anon key published in the frontend bundle
--   cannot, since the table has RLS on and no policies at all.
--
--   This is also stronger than the static secret it replaces. A secret
--   leaked once works forever; a ticket is good for one call, for five
--   minutes, for one purpose.
--
--   CRON_SECRET is no longer read by anything and can be deleted.
--
-- Run AFTER email_outbox.sql (24) and email_worker_schedule.sql (30),
-- then redeploy process-email-outbox.
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.worker_tickets (
  token     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose   TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS worker_tickets_open
  ON public.worker_tickets (issued_at)
  WHERE used_at IS NULL;

ALTER TABLE public.worker_tickets ENABLE ROW LEVEL SECURITY;

-- No policies, deliberately. A ticket is a credential; service_role
-- bypasses RLS and nothing else has any business reading or writing
-- here. This is what makes holding one meaningful.
DROP POLICY IF EXISTS "service role only" ON public.worker_tickets;


-- ── Mint one ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_worker_ticket(p_purpose TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _token UUID;
BEGIN
  IF p_purpose IS NULL OR p_purpose = '' THEN
    RAISE EXCEPTION 'A ticket needs a purpose';
  END IF;

  -- Housekeeping, here rather than in its own cron job: a ticket older
  -- than a day is spent or abandoned either way, and this runs often
  -- enough to keep the table small.
  DELETE FROM public.worker_tickets
  WHERE issued_at < NOW() - INTERVAL '1 day';

  INSERT INTO public.worker_tickets (purpose)
  VALUES (p_purpose)
  RETURNING token INTO _token;

  RETURN _token;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.issue_worker_ticket(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.issue_worker_ticket(TEXT) TO service_role;


-- ── Spend it ─────────────────────────────────────────────────────────
-- True exactly once per ticket. The UPDATE ... WHERE used_at IS NULL is
-- what makes that atomic: a replayed token finds nothing to update and
-- gets false, with no race between checking and marking.
CREATE OR REPLACE FUNCTION public.redeem_worker_ticket(
  p_token   UUID,
  p_purpose TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _ok UUID;
BEGIN
  IF p_token IS NULL THEN RETURN false; END IF;

  UPDATE public.worker_tickets t
  SET used_at = NOW()
  WHERE t.token = p_token
    AND t.purpose = p_purpose
    AND t.used_at IS NULL
    AND t.issued_at > NOW() - INTERVAL '5 minutes'
  RETURNING t.token INTO _ok;

  RETURN _ok IS NOT NULL;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.redeem_worker_ticket(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.redeem_worker_ticket(UUID, TEXT) TO service_role;


-- ── The drain, with no secret to get wrong ───────────────────────────
-- Replaces the version in email_worker_schedule.sql. The cron job set up
-- there still calls this by name, so the schedule needs no change.
CREATE OR REPLACE FUNCTION public.drain_email_outbox()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _url     TEXT := 'https://nyeulzucksldwlcrbbmo.supabase.co/functions/v1/process-email-outbox';
  _waiting INT;
  _ticket  UUID;
  _req     BIGINT;
BEGIN
  SELECT COUNT(*) INTO _waiting
  FROM public.email_outbox
  WHERE status = 'queued'
     OR (status = 'sending' AND queued_at < NOW() - INTERVAL '15 minutes');

  IF _waiting = 0 THEN
    RETURN NULL;
  END IF;

  _ticket := public.issue_worker_ticket('email_outbox');

  SELECT net.http_post(
    url     := _url,
    headers := jsonb_build_object(
                 'Content-Type',    'application/json',
                 'x-worker-ticket', _ticket::TEXT
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO _req;

  RETURN _req;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.drain_email_outbox() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.drain_email_outbox() TO service_role;


-- ── Verify ───────────────────────────────────────────────────────────
DO $do$
DECLARE
  _t      UUID;
  _first  BOOLEAN;
  _second BOOLEAN;
  _wrong  BOOLEAN;
BEGIN
  -- Prove the thing the whole design rests on: a ticket works once.
  _t      := public.issue_worker_ticket('selftest');
  _first  := public.redeem_worker_ticket(_t, 'selftest');
  _second := public.redeem_worker_ticket(_t, 'selftest');
  _wrong  := public.redeem_worker_ticket(gen_random_uuid(), 'selftest');

  DELETE FROM public.worker_tickets WHERE purpose = 'selftest';

  IF _first AND NOT _second AND NOT _wrong THEN
    RAISE NOTICE 'Ticket check passed: redeems once, refuses a replay, refuses an unknown token.';
  ELSE
    RAISE WARNING 'Ticket check FAILED (first=% second=% unknown=%). Do not rely on this yet.',
      _first, _second, _wrong;
  END IF;

  RAISE NOTICE 'CRON_SECRET and the covo_cron_secret Vault entry are no longer used by anything.';
  RAISE NOTICE 'Next: redeploy process-email-outbox, then SELECT public.drain_email_outbox();';
END;
$do$;
