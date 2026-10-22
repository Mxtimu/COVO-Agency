-- ════════════════════════════════════════════════════════════════════
-- COVO — the thing that actually drains the email queue
--
-- email_outbox.sql built the queue and process-email-outbox sends from
-- it, but NOTHING EVER CALLED THE FUNCTION. Every mention of it in SQL
-- was a comment. So a payout notice, a low-balance warning and a
-- waitlist welcome would all queue correctly and then sit there
-- indefinitely, with the system looking healthy the whole time — rows
-- in 'queued', no errors anywhere, and nobody receiving anything.
--
-- pg_cron cannot make an HTTP request on its own, which is why the gap
-- existed. pg_net adds that, so the chain becomes:
--
--   pg_cron (every 5 min) → pg_net → process-email-outbox → Resend
--
-- The Edge Function stays responsible for the sending and for marking
-- each row sent or failed. pg_net only pokes it. Calling Resend directly
-- from Postgres would remove a hop but pg_net is asynchronous — replies
-- land later in net._http_response — so tracking which message
-- succeeded would mean rebuilding, in plpgsql, the retry bookkeeping the
-- function already does synchronously.
--
-- BEFORE THIS WORKS, TWO THINGS MUST MATCH:
--
--   1. The shared secret in Supabase Vault:
--
--        SELECT vault.create_secret(
--          '<a long random string>', 'covo_cron_secret',
--          'Shared secret for process-email-outbox');
--
--   2. The same value as the CRON_SECRET Edge Function secret
--      (Dashboard → Project → Edge Functions → Secrets).
--
--   The function refuses to run without CRON_SECRET and answers 401 on a
--   mismatch, deliberately: it sends mail and the anon key is published
--   in the frontend bundle, so the secret is the only real gate.
--
--   The secret is read from Vault rather than written into this file so
--   it is not committed, and not left in cron.job for anyone who can
--   read that table.
--
-- Run AFTER email_outbox.sql (24).
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;


-- ── One call to the worker ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.drain_email_outbox()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _secret  TEXT;
  _url     TEXT := 'https://nyeulzucksldwlcrbbmo.supabase.co/functions/v1/process-email-outbox';
  _waiting INT;
  _req     BIGINT;
BEGIN
  -- Nothing queued: do not spend a request finding that out.
  SELECT COUNT(*) INTO _waiting
  FROM public.email_outbox
  WHERE status = 'queued'
     OR (status = 'sending' AND queued_at < NOW() - INTERVAL '15 minutes');

  IF _waiting = 0 THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO _secret
    FROM vault.decrypted_secrets
    WHERE name = 'covo_cron_secret';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'drain_email_outbox: cannot read Vault (%). Nothing sent.', SQLERRM;
    RETURN NULL;
  END;

  IF _secret IS NULL OR _secret = '' THEN
    -- Loud, because the symptom otherwise is silence: mail queues up and
    -- nobody is told why it is not moving.
    RAISE WARNING 'drain_email_outbox: no Vault secret named covo_cron_secret. % message(s) waiting and not being sent.', _waiting;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := _url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', _secret
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO _req;

  RETURN _req;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.drain_email_outbox() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.drain_email_outbox() TO service_role;


-- ── What the queue looks like ────────────────────────────────────────
-- email_outbox has no RLS policies at all, so this is the only way to
-- see it from a session that is not the service role.
CREATE OR REPLACE FUNCTION public.email_outbox_status()
RETURNS TABLE (
  kind        TEXT,
  status      TEXT,
  messages    INT,
  oldest      TIMESTAMPTZ,
  last_error  TEXT
)
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
  SELECT e.kind, e.status, COUNT(*)::INT, MIN(e.queued_at), MAX(e.last_error)
  FROM public.email_outbox e
  WHERE public.can_act_as_admin()
  GROUP BY e.kind, e.status
  ORDER BY e.kind, e.status;
$fn$;

REVOKE EXECUTE ON FUNCTION public.email_outbox_status() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.email_outbox_status() TO authenticated, service_role;


-- ── Schedule ─────────────────────────────────────────────────────────
-- Every five minutes. The worker takes 20 messages a run, paced to stay
-- under Resend's 2 requests/second, so a run is about 11 seconds and a
-- backlog of a few hundred clears within the hour. Frequent enough that
-- a welcome email arrives while the person still remembers signing up.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'pg_cron is not installed — drain_email_outbox() must be called by hand.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('covo-drain-email-outbox')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'covo-drain-email-outbox');

  PERFORM cron.schedule('covo-drain-email-outbox', '*/5 * * * *',
    $job$ SELECT public.drain_email_outbox(); $job$);

  RAISE NOTICE 'Scheduled: covo-drain-email-outbox every 5 minutes.';
END;
$do$;


-- ── Verify ───────────────────────────────────────────────────────────
DO $do$
DECLARE
  _net    BOOLEAN;
  _vault  BOOLEAN;
  _queued INT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') INTO _net;

  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM vault.decrypted_secrets WHERE name = 'covo_cron_secret'
    ) INTO _vault;
  EXCEPTION WHEN OTHERS THEN
    _vault := false;
  END;

  SELECT COUNT(*) INTO _queued FROM public.email_outbox WHERE status = 'queued';

  RAISE NOTICE 'pg_net installed        : %', _net;
  RAISE NOTICE 'Vault secret present    : %', _vault;
  RAISE NOTICE 'Messages queued now     : %', _queued;

  IF NOT _vault THEN
    RAISE WARNING 'No covo_cron_secret in Vault. The schedule is live but every run will refuse to call the worker until you add it — see the header of this file.';
  END IF;
END;
$do$;
