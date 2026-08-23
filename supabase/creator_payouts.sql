-- ════════════════════════════════════════════════════════════════════
-- COVO — creator payout requests
--
-- The amount is computed inside the database, never accepted from the
-- client. A browser can be made to send any number it likes, so a
-- client-supplied amount would let a creator request more than they have
-- earned. The only thing the client gets to do is ask.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.request_creator_payout()
RETURNS TABLE (payout_id UUID, amount NUMERIC, commission_count INT)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _creator   UUID := auth.uid();
  _min       NUMERIC := 250;
  _available NUMERIC;
  _ids       UUID[];
  _payout    UUID;
BEGIN
  IF _creator IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Confirmed commissions not already inside a payout. commission_ids on
  -- earlier payouts is what stops the same earnings being claimed twice.
  SELECT COALESCE(SUM(c.net_commission), 0), COALESCE(ARRAY_AGG(c.id), '{}')
    INTO _available, _ids
  FROM public.commissions c
  WHERE c.creator_id = _creator
    AND c.status = 'confirmed'
    AND NOT EXISTS (
      SELECT 1 FROM public.payouts p
      WHERE p.creator_id = _creator
        AND p.status IN ('pending','processing','success')
        AND c.id = ANY(p.commission_ids)
    );

  IF _available < _min THEN
    RAISE EXCEPTION 'A minimum of R% is required to withdraw. You have R% available.',
      _min, ROUND(_available, 2);
  END IF;

  INSERT INTO public.payouts (creator_id, amount, status, commission_ids)
  VALUES (_creator, _available, 'pending', _ids)
  RETURNING id INTO _payout;

  RETURN QUERY SELECT _payout, _available, COALESCE(ARRAY_LENGTH(_ids, 1), 0);
END;
$$;

-- Creators call this; they never INSERT into payouts directly.
REVOKE EXECUTE ON FUNCTION public.request_creator_payout() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_creator_payout() TO authenticated;

-- Deliberately no INSERT policy for creators on payouts: the SECURITY DEFINER
-- function above is the only sanctioned path, so the amount cannot be forged.
DROP POLICY IF EXISTS "creators read own payouts" ON public.payouts;
CREATE POLICY "creators read own payouts" ON public.payouts
  FOR SELECT USING (creator_id = auth.uid());
