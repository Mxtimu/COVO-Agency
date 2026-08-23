-- ════════════════════════════════════════════════════════════════════
-- COVO — waitlist
--
-- The landing page was writing signups into the visitor's own
-- localStorage and showing them a success message. Every lead collected
-- since launch was discarded. This is where they belong.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.waitlist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  source     TEXT,              -- which page or campaign sent them
  user_agent TEXT,
  notes      TEXT,
  contacted  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Case-insensitive uniqueness: Person@x.com and person@x.com are one lead.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_key ON public.waitlist (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON public.waitlist (created_at DESC);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can join the waitlist" ON public.waitlist;
DROP POLICY IF EXISTS "admins read waitlist"         ON public.waitlist;
DROP POLICY IF EXISTS "admins manage waitlist"       ON public.waitlist;

-- Anyone may add themselves — it is a public form on the landing page.
CREATE POLICY "anyone can join the waitlist" ON public.waitlist
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Deliberately no public SELECT. Without this asymmetry the anon key could
-- be used to read every address on the list, which is a mailing list any
-- competitor would happily download.
CREATE POLICY "admins manage waitlist" ON public.waitlist
  FOR ALL USING (public.is_admin());
