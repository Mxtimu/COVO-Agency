-- ════════════════════════════════════════════════════════════════════
-- COVO — rate limiting the webhook endpoints
--
-- The fabricated-sales hole is already closed: record-conversion is
-- retired and returns 410, and conversions now arrive only on a
-- HMAC-signed Shopify webhook. Forging one requires the shop's signing
-- secret, which is not published anywhere.
--
-- This covers what the signature does not. A signature proves who sent a
-- request; it says nothing about how many. If a secret ever does leak,
-- the holder can mint valid signatures as fast as they can post, and the
-- first thing anyone would notice is a brand's escrow draining. It also
-- catches the duller failure — a misconfigured integration redelivering
-- the same event in a loop, which costs the same database work as an
-- attack without anyone meaning harm.
--
-- The counter lives in the database rather than the Edge Function
-- because Edge Functions are per-isolate: an in-memory counter resets
-- whenever the platform spins up a new one, which is exactly when a
-- burst would be arriving.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.webhook_hits (
  id         BIGSERIAL PRIMARY KEY,
  endpoint   TEXT NOT NULL,
  -- Shop domain, Paystack reference prefix, or whatever the caller can be
  -- identified by. Never an IP: these callers are Shopify and Paystack,
  -- whose addresses are shared and change.
  actor      TEXT NOT NULL,
  accepted   BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_hits_window
  ON public.webhook_hits (endpoint, actor, created_at DESC);

-- Nobody but the service role has any business reading this.
ALTER TABLE public.webhook_hits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON public.webhook_hits;


-- ── Record a hit and say whether to serve it ─────────────────────────
-- One statement so a burst arriving together cannot each read a count of
-- zero and each decide they are the first.
CREATE OR REPLACE FUNCTION public.check_webhook_rate(
  p_endpoint     TEXT,
  p_actor        TEXT,
  p_limit        INT DEFAULT 120,
  p_window_secs  INT DEFAULT 60
)
RETURNS TABLE (allowed BOOLEAN, hits INT, retry_after_secs INT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _hits INT;
BEGIN
  INSERT INTO public.webhook_hits (endpoint, actor, accepted)
  VALUES (p_endpoint, COALESCE(NULLIF(TRIM(p_actor), ''), 'unknown'), true);

  SELECT COUNT(*) INTO _hits
  FROM public.webhook_hits w
  WHERE w.endpoint   = p_endpoint
    AND w.actor      = COALESCE(NULLIF(TRIM(p_actor), ''), 'unknown')
    AND w.created_at > NOW() - (p_window_secs || ' seconds')::INTERVAL;

  IF _hits > p_limit THEN
    UPDATE public.webhook_hits SET accepted = false
    WHERE id = (SELECT MAX(id) FROM public.webhook_hits
                WHERE endpoint = p_endpoint AND actor = p_actor);
    RETURN QUERY SELECT false, _hits, p_window_secs;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, _hits, 0;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.check_webhook_rate(TEXT, TEXT, INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_webhook_rate(TEXT, TEXT, INT, INT) TO service_role;


-- ── Keep the table from becoming a log ───────────────────────────────
-- It only exists to answer "how many in the last minute", so anything
-- older than a day is dead weight. Rejections are kept a week — a burst
-- worth rate limiting is worth being able to look at afterwards.
CREATE OR REPLACE FUNCTION public.prune_webhook_hits()
RETURNS TABLE (removed INT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _n INT;
BEGIN
  WITH gone AS (
    DELETE FROM public.webhook_hits
    WHERE (accepted AND created_at < NOW() - INTERVAL '1 day')
       OR (NOT accepted AND created_at < NOW() - INTERVAL '7 days')
    RETURNING id
  )
  SELECT COUNT(*) INTO _n FROM gone;
  RETURN QUERY SELECT _n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.prune_webhook_hits() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.prune_webhook_hits() TO service_role;

DO $do$
BEGIN
  PERFORM cron.unschedule('covo-prune-webhook-hits');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$do$;

SELECT cron.schedule(
  'covo-prune-webhook-hits',
  '30 3 * * *',
  $job$SELECT public.prune_webhook_hits()$job$
);


-- ── What has been rejected lately ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.webhook_rejections()
RETURNS TABLE (endpoint TEXT, actor TEXT, rejections INT, first_seen TIMESTAMPTZ, last_seen TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
  SELECT w.endpoint, w.actor, COUNT(*)::INT, MIN(w.created_at), MAX(w.created_at)
  FROM public.webhook_hits w
  WHERE NOT w.accepted
    AND public.can_act_as_admin()
  GROUP BY w.endpoint, w.actor
  ORDER BY MAX(w.created_at) DESC;
$fn$;

REVOKE EXECUTE ON FUNCTION public.webhook_rejections() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.webhook_rejections() TO authenticated, service_role;
