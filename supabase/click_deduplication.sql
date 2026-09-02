-- ════════════════════════════════════════════════════════════════════
-- COVO — count a click once per visitor
--
-- Every link showed roughly double the clicks it had really had.
--
-- affiliate-redirect inserts exactly one row per invocation, and nothing
-- else writes to clicks — so the count was not wrong, the function was
-- simply being invoked twice for one human. serve() accepted any method
-- with no guard, so:
--
--   * a HEAD followed by a GET is two rows, and that is precisely what a
--     link-preview crawler does — which is the normal path for a creator
--     link, since it is shared into WhatsApp, Slack or iMessage before
--     anyone clicks it;
--   * Chrome speculatively prefetches a URL it thinks you are about to
--     visit, then fetches it again when you actually do.
--
-- The method and prefetch filtering lives in the Edge Function, where the
-- headers are. This is the second half: a real visitor who double-taps,
-- refreshes, or is re-sent through the redirect still counts once.
--
-- The dedupe key is (link, ip_hash) inside a short window. Two people
-- behind one NAT clicking the same link within 30 seconds will therefore
-- count once — that is a real cost, accepted because inflating a
-- creator's traffic is the worse error: it feeds the conversion rate
-- that drives 40 points of their COVO Score, so double-counting clicks
-- silently deflates every creator's score.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- Supports the NOT EXISTS lookup below. Without it every redirect would
-- scan the clicks table.
CREATE INDEX IF NOT EXISTS idx_clicks_dedupe
  ON public.clicks (affiliate_link_id, ip_hash, clicked_at DESC);

CREATE OR REPLACE FUNCTION public.record_click(
  p_link_id     UUID,
  p_creator_id  UUID,
  p_campaign_id UUID,
  p_product_id  UUID,
  p_ip_hash     TEXT,
  p_user_agent  TEXT DEFAULT NULL,
  p_referrer    TEXT DEFAULT NULL,
  p_window_secs INT  DEFAULT 30
)
RETURNS TABLE (counted BOOLEAN, click_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _id UUID;
BEGIN
  -- One statement, so the check and the insert cannot interleave. Doing
  -- this as SELECT-then-INSERT from the Edge Function would let a
  -- prefetch and the real navigation — which arrive milliseconds apart —
  -- both find nothing and both insert.
  INSERT INTO public.clicks (
    affiliate_link_id, creator_id, campaign_id, product_id,
    ip_hash, user_agent, referrer
  )
  SELECT p_link_id, p_creator_id, p_campaign_id, p_product_id,
         p_ip_hash, p_user_agent, p_referrer
  WHERE NOT EXISTS (
    SELECT 1 FROM public.clicks c
    WHERE c.affiliate_link_id = p_link_id
      AND c.ip_hash           = p_ip_hash
      AND c.clicked_at        > NOW() - (p_window_secs || ' seconds')::INTERVAL
  )
  RETURNING id INTO _id;

  RETURN QUERY SELECT (_id IS NOT NULL), _id;
END;
$fn$;

-- Only the redirect function calls this, and it holds the service role.
REVOKE EXECUTE ON FUNCTION public.record_click(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_click(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, INT)
  TO service_role;


-- ── The dead counter ─────────────────────────────────────────────────
-- affiliate_links.clicks has been there since the first schema and
-- nothing has ever written to it. Every reader already counts rows in
-- the clicks table instead. Leaving a column that looks authoritative
-- and is permanently zero is an invitation for someone to read it one
-- day and believe it, so it is dropped rather than left to mislead.
ALTER TABLE public.affiliate_links DROP COLUMN IF EXISTS clicks;


-- ── How much inflation was there? ────────────────────────────────────
-- Reports the historical damage without altering it. Deleting rows that
-- past scores were computed from would move every affected creator's
-- COVO Score with no record of why, so this only measures.
DO $do$
DECLARE
  _dupes INT;
  _total INT;
BEGIN
  SELECT COUNT(*) INTO _total FROM public.clicks;

  SELECT COUNT(*) INTO _dupes
  FROM (
    SELECT affiliate_link_id, ip_hash, clicked_at,
           LAG(clicked_at) OVER (
             PARTITION BY affiliate_link_id, ip_hash ORDER BY clicked_at
           ) AS prev
    FROM public.clicks
    WHERE ip_hash IS NOT NULL
  ) w
  WHERE prev IS NOT NULL AND clicked_at - prev < INTERVAL '30 seconds';

  IF _total = 0 THEN
    RAISE NOTICE 'clicks: table is empty — nothing to assess.';
  ELSE
    RAISE NOTICE 'clicks: % of % row(s) look like duplicates of a click within 30s from the same visitor (%.1f%%).',
      _dupes, _total, (_dupes::NUMERIC / _total * 100);
    RAISE NOTICE 'Left in place deliberately: past COVO Scores were calculated from them, and deleting would move scores with no record of why. New clicks are deduplicated from now on.';
  END IF;
END;
$do$;
