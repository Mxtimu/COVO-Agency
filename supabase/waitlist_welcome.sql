-- ════════════════════════════════════════════════════════════════════
-- COVO — "you're on the list" confirmation
--
-- Queues a short confirmation the moment somebody joins the waitlist, so
-- a signup today is not silently forgotten while email delivery is still
-- being sorted out.
--
-- IT CANNOT ACTUALLY SEND YET, AND THAT IS FINE.
--
--   Resend only delivers to the account's own address
--   (covodeveloper@gmail.com) until a sending domain is verified, and
--   process-email-outbox is not deployed. So rows queue and wait. The
--   moment joincovo.app is verified in Resend and the worker is
--   deployed, everyone who signed up in the meantime gets their email —
--   nobody has to be found and mailed by hand afterwards.
--
--   That is the whole reason to run this now rather than on the day
--   email starts working.
--
-- THE TRIGGER MUST NEVER BLOCK A SIGNUP.
--
--   An AFTER INSERT trigger that raises takes the INSERT down with it.
--   A person trying to join the waitlist would get "something went
--   wrong" because of a problem with a courtesy email, which is a
--   spectacularly bad trade. Everything below is wrapped so that a
--   failure to queue is logged and swallowed — the signup is what
--   matters and it always lands.
--
-- Run AFTER email_outbox.sql (24) and waitlist.sql (9).
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.queue_waitlist_welcome()
RETURNS TRIGGER
-- SECURITY DEFINER because the caller is `anon`: a visitor on
-- joincovo.app inserting their own row. enqueue_email is granted to
-- service_role only, so an INVOKER trigger would be refused on every
-- public signup — which, without the exception handler below, would mean
-- nobody could join the waitlist at all.
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _side TEXT;
BEGIN
  -- They told us which they were when they signed up, so the line that
  -- matters to them comes first rather than a paragraph covering both.
  _side := CASE
    WHEN NEW.source = 'site:brand'   THEN
      'When we open, you will be able to fund a campaign, set your commission '
      || 'rate, and work with creators who are paid only when they sell.'
    WHEN NEW.source = 'site:creator' THEN
      'When we open, you will be able to browse campaigns, get your own tracked '
      || 'links, and earn commission on the sales you drive.'
    ELSE
      'When we open, you will be able to sign up as a brand looking for creators '
      || 'who sell, or as a creator who would rather earn on results than reach.'
  END;

  PERFORM public.enqueue_email(
    NEW.email,
    'You''re on the COVO waitlist',
    format(
      'Hi,' || chr(10) || chr(10) ||
      'Thanks for joining the COVO waitlist — you are on it.' || chr(10) || chr(10) ||
      '%s' || chr(10) || chr(10) ||
      'We will email you once when we launch. Nothing else, and we will not '
      || 'share your address.' || chr(10) || chr(10) ||
      'COVO' || chr(10) ||
      'Cape Town, South Africa',
      _side
    ),
    'waitlist_welcome',
    NEW.id
  );

  RETURN NULL;  -- AFTER trigger; the return value is ignored.
EXCEPTION WHEN OTHERS THEN
  -- The signup has already been written by the time this runs. Losing the
  -- courtesy email is an annoyance; losing the lead because of it is not
  -- acceptable, so this is swallowed deliberately rather than raised.
  RAISE WARNING 'queue_waitlist_welcome failed for % (%): %',
    NEW.email, NEW.id, SQLERRM;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS queue_waitlist_welcome ON public.waitlist;
CREATE TRIGGER queue_waitlist_welcome
  AFTER INSERT ON public.waitlist
  FOR EACH ROW EXECUTE FUNCTION public.queue_waitlist_welcome();


-- ── Backfill anyone who joined before this existed ───────────────────
-- Including every signup from the Vercel landing page. The unique index
-- on (kind, subject_id) means running this twice queues nothing extra.
CREATE OR REPLACE FUNCTION public.backfill_waitlist_welcome()
RETURNS TABLE (queued INT, already_had_one INT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _w    RECORD;
  _new  INT := 0;
  _had  INT := 0;
BEGIN
  IF NOT public.can_act_as_admin() THEN
    RAISE EXCEPTION 'Only an administrator may backfill waitlist email'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR _w IN
    SELECT w.id, w.email, w.source FROM public.waitlist w ORDER BY w.created_at
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.email_outbox e
      WHERE e.kind = 'waitlist_welcome' AND e.subject_id = _w.id
    ) THEN
      _had := _had + 1;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.enqueue_email(
        _w.email,
        'You''re on the COVO waitlist',
        'Hi,' || chr(10) || chr(10) ||
        'Thanks for joining the COVO waitlist — you are on it.' || chr(10) || chr(10) ||
        'We will email you once when we launch. Nothing else, and we will not '
        || 'share your address.' || chr(10) || chr(10) ||
        'COVO' || chr(10) ||
        'Cape Town, South Africa',
        'waitlist_welcome',
        _w.id
      );
      _new := _new + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'backfill skipped % : %', _w.email, SQLERRM;
    END;
  END LOOP;

  RETURN QUERY SELECT _new, _had;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.backfill_waitlist_welcome() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.backfill_waitlist_welcome() TO authenticated, service_role;


-- ── Verify ───────────────────────────────────────────────────────────
DO $do$
DECLARE _list INT; _queued INT;
BEGIN
  SELECT COUNT(*) INTO _list   FROM public.waitlist;
  SELECT COUNT(*) INTO _queued FROM public.email_outbox WHERE kind = 'waitlist_welcome';

  RAISE NOTICE 'Waitlist: % signup(s). Welcome emails queued: %.', _list, _queued;
  RAISE NOTICE 'New signups are queued automatically from now on.';
  RAISE NOTICE 'For everyone who joined before this: SELECT * FROM public.backfill_waitlist_welcome();';
  RAISE NOTICE 'Nothing sends until joincovo.app is verified in Resend and process-email-outbox is deployed.';
END;
$do$;
