-- ════════════════════════════════════════════════════════════════════
-- COVO — the one email the waitlist was promised
--
-- The site tells people "one email when we launch. Nothing else." This is
-- how that promise is kept, and it reuses email_outbox rather than adding
-- a second way of sending mail.
--
-- WHY IT IS NOT A LOOP IN A SCRIPT
--
--   Launch mail goes out once, to everybody, and a half-finished run is
--   the expensive mistake: re-running it would mail the first half twice.
--   Queueing into email_outbox makes that impossible — the unique index
--   on (kind, subject_id) means a second run over the same waitlist rows
--   inserts nothing, and the `contacted` flag records who has been
--   handled regardless of whether delivery has happened yet.
--
--   It also means the send survives Resend being rate-limited or the
--   domain not being verified yet. Rows wait; process-email-outbox
--   drains them when it can.
--
-- NOT SCHEDULED, DELIBERATELY. There is no cron here: launching is a
-- decision somebody makes on a particular morning, not something a
-- timer should do. An admin runs enqueue_waitlist_launch_emails() and
-- the outbox worker does the rest.
--
-- Run AFTER email_outbox.sql and waitlist.sql.
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;


-- ── What the list looks like ─────────────────────────────────────────
-- The waitlist has no public SELECT policy, so there is no way to see it
-- from a browser session that is not an admin's. This is that view.
CREATE OR REPLACE FUNCTION public.waitlist_summary()
RETURNS TABLE (
  total          INT,
  creators       INT,
  brands         INT,
  unspecified    INT,
  contacted      INT,
  waiting        INT,
  first_signup   TIMESTAMPTZ,
  latest_signup  TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $fn$
  SELECT
    COUNT(*)::INT,
    COUNT(*) FILTER (WHERE w.source = 'site:creator')::INT,
    COUNT(*) FILTER (WHERE w.source = 'site:brand')::INT,
    COUNT(*) FILTER (WHERE w.source IS NULL
                        OR w.source NOT IN ('site:creator', 'site:brand'))::INT,
    COUNT(*) FILTER (WHERE w.contacted)::INT,
    COUNT(*) FILTER (WHERE NOT w.contacted)::INT,
    MIN(w.created_at),
    MAX(w.created_at)
  FROM public.waitlist w
  WHERE public.can_act_as_admin();
$fn$;

REVOKE EXECUTE ON FUNCTION public.waitlist_summary() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.waitlist_summary() TO authenticated, service_role;


-- ── Queue the launch announcement ────────────────────────────────────
-- p_dry_run is the default on purpose. The destructive reading of this
-- function ("mail two thousand people") should require saying so, not
-- happen because somebody ran the file to see what it did.
CREATE OR REPLACE FUNCTION public.enqueue_waitlist_launch_emails(
  p_dry_run BOOLEAN DEFAULT true
)
RETURNS TABLE (
  queued      INT,
  skipped     INT,
  would_send  INT,
  outcome     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _w        RECORD;
  _queued   INT := 0;
  _skipped  INT := 0;
  _pending  INT := 0;
  _greeting TEXT;
  _id       UUID;
BEGIN
  IF NOT public.can_act_as_admin() THEN
    RAISE EXCEPTION 'Only an administrator may send the launch announcement'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COUNT(*)::INT INTO _pending
  FROM public.waitlist w WHERE NOT w.contacted;

  IF p_dry_run THEN
    RETURN QUERY SELECT 0, 0, _pending,
      format('Dry run. %s address(es) would be mailed. Call enqueue_waitlist_launch_emails(false) to queue them.',
             _pending)::TEXT;
    RETURN;
  END IF;

  FOR _w IN
    SELECT w.id, w.email, w.source
    FROM public.waitlist w
    WHERE NOT w.contacted
    ORDER BY w.created_at
    FOR UPDATE
  LOOP
    -- They told us which side they were on when they signed up, so the
    -- email opens on the thing they actually came for rather than a
    -- paragraph covering both.
    _greeting := CASE
      WHEN _w.source = 'site:brand' THEN
        'COVO is open. You can create your first campaign, set your commission '
        || 'rate, and invite creators who get paid only when they sell.'
      WHEN _w.source = 'site:creator' THEN
        'COVO is open. You can browse campaigns, get your own tracked links, '
        || 'and start earning commission on the sales you drive.'
      ELSE
        'COVO is open. Whether you are a brand looking for creators who sell, '
        || 'or a creator who would rather earn on results than on reach, you '
        || 'can sign up now.'
    END;

    _id := public.enqueue_email(
      _w.email,
      'COVO is open — your early access is ready',
      format(
        'Hi,' || chr(10) || chr(10) ||
        '%s' || chr(10) || chr(10) ||
        'Sign up here: https://covoafrica.vercel.app/auth' || chr(10) || chr(10) ||
        'You are getting this because you joined the COVO waitlist. This is the '
        || 'one email we said we would send.' || chr(10) || chr(10) ||
        'COVO' || chr(10) ||
        'Cape Town, South Africa',
        _greeting
      ),
      'waitlist_launch',
      _w.id
    );

    IF _id IS NULL THEN
      -- Either already queued (the unique index refused it) or the address
      -- is unusable. Either way it does not need queueing again, and the
      -- flag is still set so a later run does not keep retrying it.
      _skipped := _skipped + 1;
    ELSE
      _queued := _queued + 1;
    END IF;

    UPDATE public.waitlist
    SET contacted = true, contacted_at = COALESCE(contacted_at, NOW())
    WHERE id = _w.id;
  END LOOP;

  RETURN QUERY SELECT _queued, _skipped, 0,
    CASE WHEN _queued = 0
      THEN 'Nothing new to queue.'
      ELSE format('%s email(s) queued. process-email-outbox sends them; check email_outbox for progress.', _queued)
    END::TEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.enqueue_waitlist_launch_emails(BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.enqueue_waitlist_launch_emails(BOOLEAN) TO authenticated, service_role;


-- ── Verify ───────────────────────────────────────────────────────────
DO $do$
DECLARE _s RECORD;
BEGIN
  SELECT * INTO _s FROM public.waitlist_summary();

  RAISE NOTICE 'Waitlist: % total (% creators, % brands, % unspecified).',
    COALESCE(_s.total, 0), COALESCE(_s.creators, 0),
    COALESCE(_s.brands, 0), COALESCE(_s.unspecified, 0);
  RAISE NOTICE '% already contacted, % still waiting.',
    COALESCE(_s.contacted, 0), COALESCE(_s.waiting, 0);
  RAISE NOTICE 'Launch day: SELECT * FROM public.enqueue_waitlist_launch_emails(false);';
END;
$do$;
