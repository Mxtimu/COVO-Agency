-- ════════════════════════════════════════════════════════════════════
-- COVO — transactional email, queued rather than sent inline
--
-- There was no way for the server to send email at all. EmailJS is a
-- browser SDK: it needs a DOM and a public key, so no Edge Function,
-- trigger or cron job can reach it. Every notification COVO owes
-- someone — your payout is on its way, your campaign is nearly out of
-- money — had nowhere to go.
--
-- Mail is queued here instead of sent inline, for three reasons.
--
--   A database function cannot make an HTTP call, so the payout
--   function could not email anybody even if Resend were wide open.
--
--   Sending inline would put a third party inside a money transaction.
--   If Resend is slow or down the payout must still commit: an email
--   that failed to send is an annoyance, a payout rolled back because
--   of it is a creator not getting paid.
--
--   Delivery is currently restricted. Resend's free tier sends only to
--   the account's own address (covodeveloper@gmail.com) until a domain
--   is verified under Resend → Domains, so mail to a creator is
--   rejected today. Queued rows survive that: they accumulate with the
--   error recorded and go out when the domain lands, rather than being
--   lost in the gap.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient     TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body_text     TEXT NOT NULL,
  body_html     TEXT,
  -- What this message is about, so a bug in one kind of mail can be
  -- found and re-sent without trawling the whole table.
  kind          TEXT NOT NULL,
  -- The thing the message concerns (a payout id, a campaign id). With
  -- `kind` it forms the idempotency key below.
  subject_id    UUID,
  status        TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','sent','failed')),
  attempts      INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  provider_id   TEXT,
  queued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at       TIMESTAMPTZ
);

-- One message per thing per kind. A payout batch that runs twice, or a
-- webhook Paystack redelivers, must not email the same creator twice —
-- enforced by the database rather than by remembering to check, because
-- "send the email" is the step most easily repeated.
CREATE UNIQUE INDEX IF NOT EXISTS email_outbox_once
  ON public.email_outbox (kind, subject_id)
  WHERE subject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_outbox_pending
  ON public.email_outbox (status, queued_at)
  WHERE status IN ('queued', 'sending');

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

-- No policies, deliberately: queued mail holds other people's addresses
-- and payout amounts. service_role bypasses RLS, and nothing in the
-- browser has any business reading this table.
DROP POLICY IF EXISTS "service role only" ON public.email_outbox;


-- ── Enqueue ──────────────────────────────────────────────────────────
-- Returns the row id, or NULL when this exact message was already queued.
CREATE OR REPLACE FUNCTION public.enqueue_email(
  p_recipient  TEXT,
  p_subject    TEXT,
  p_body_text  TEXT,
  p_kind       TEXT,
  p_subject_id UUID DEFAULT NULL,
  p_body_html  TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _id UUID;
BEGIN
  -- A missing address is not worth failing a payout over, but it must
  -- not pass silently either.
  IF p_recipient IS NULL OR POSITION('@' IN p_recipient) = 0 THEN
    RAISE WARNING 'enqueue_email: no usable address for % (%), nothing queued',
      p_kind, p_subject_id;
    RETURN NULL;
  END IF;

  INSERT INTO public.email_outbox (recipient, subject, body_text, body_html, kind, subject_id)
  VALUES (LOWER(TRIM(p_recipient)), p_subject, p_body_text, p_body_html, p_kind, p_subject_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO _id;

  RETURN _id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, TEXT, TEXT, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enqueue_email(TEXT, TEXT, TEXT, TEXT, UUID, TEXT)
  TO service_role;


-- ── Claim a batch to send ────────────────────────────────────────────
-- Claims before returning, so two overlapping worker runs cannot both
-- send the same message. A 'sending' row older than 15 minutes is taken
-- back: that means a worker died mid-flight, and the alternative is mail
-- that never goes out at all.
CREATE OR REPLACE FUNCTION public.claim_emails_to_send(p_limit INT DEFAULT 25)
RETURNS TABLE (
  id        UUID,
  recipient TEXT,
  subject   TEXT,
  body_text TEXT,
  body_html TEXT,
  kind      TEXT,
  attempts  INT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT e.id
    FROM public.email_outbox e
    WHERE (e.status = 'queued'
           OR (e.status = 'sending' AND e.queued_at < NOW() - INTERVAL '15 minutes'))
      AND e.attempts < 5
    ORDER BY e.queued_at
    LIMIT GREATEST(1, LEAST(p_limit, 100))
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.email_outbox e
    SET status = 'sending', attempts = e.attempts + 1
    WHERE e.id IN (SELECT d.id FROM due d)
    RETURNING e.id, e.recipient, e.subject, e.body_text, e.body_html, e.kind, e.attempts
  )
  SELECT c.id, c.recipient, c.subject, c.body_text, c.body_html, c.kind, c.attempts
  FROM claimed c;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.claim_emails_to_send(INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_emails_to_send(INT) TO service_role;


CREATE OR REPLACE FUNCTION public.mark_email_sent(p_id UUID, p_provider_id TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $fn$
  UPDATE public.email_outbox
  SET status = 'sent', sent_at = NOW(), provider_id = p_provider_id, last_error = NULL
  WHERE id = p_id;
$fn$;

-- Five attempts, then 'failed' so it stops being retried forever. The
-- error text is kept: a run of "domain not verified" failures is a
-- Resend setting rather than a code fault, and the message is what
-- tells the two apart.
CREATE OR REPLACE FUNCTION public.mark_email_failed(p_id UUID, p_error TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $fn$
  UPDATE public.email_outbox
  SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
      last_error = p_error
  WHERE id = p_id;
$fn$;

REVOKE EXECUTE ON FUNCTION public.mark_email_sent(UUID, TEXT)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_email_failed(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_email_sent(UUID, TEXT)   TO service_role;
GRANT  EXECUTE ON FUNCTION public.mark_email_failed(UUID, TEXT) TO service_role;


-- Re-arm everything that gave up, for the day the Resend domain is
-- verified and the backlog can finally go out.
CREATE OR REPLACE FUNCTION public.requeue_failed_emails()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _n INT;
BEGIN
  IF NOT public.can_act_as_admin() THEN
    RAISE EXCEPTION 'Only an administrator may requeue email'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH back AS (
    UPDATE public.email_outbox
    SET status = 'queued', attempts = 0, queued_at = NOW()
    WHERE status = 'failed'
    RETURNING id
  )
  SELECT COUNT(*) INTO _n FROM back;
  RETURN _n;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.requeue_failed_emails() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.requeue_failed_emails() TO authenticated, service_role;


DO $do$
BEGIN
  RAISE NOTICE 'email_outbox ready — queued mail waits here until process-email-outbox drains it.';
  RAISE NOTICE 'Resend free tier delivers only to the account address until a domain is verified.';
END;
$do$;
