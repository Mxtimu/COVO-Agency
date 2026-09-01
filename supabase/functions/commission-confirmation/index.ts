import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// The commission cycle lives in the database (run_commission_cycle in
// supabase/escrow_release.sql) and runs there nightly on pg_cron. This
// endpoint exists only so an admin can trigger a run on demand — it calls the
// same function rather than reimplementing it, so the two can never drift.
//
// It previously called confirm_due_commissions() directly, which had become
// only half the cycle: the nightly job releases held commissions first, so a
// manual run skipped that step and behaved differently from the scheduled one.
//
// It also had no authentication of any kind, and was deployed with
// --no-verify-jwt, which made it a public endpoint that moved money state.
// Anyone who knew the URL could trigger escrow drawdowns. It could not confirm
// anything that was not already due — but an unauthenticated write path into
// the ledger is not something to leave open on the grounds that the damage
// would be limited.
serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ error: 'Not authenticated' }, 401)

  // The platform's JWT gate only proves the caller holds *a* valid token, and
  // the anon key is one — so the role check has to happen here.
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: { user }, error: userError } = await caller.auth.getUser()
  if (userError || !user) return json({ error: 'Not authenticated' }, 401)

  // Read with the service-role client so RLS cannot hide the role.
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()

  if (profile?.role !== 'admin') {
    return json({ error: 'Only COVO admins can run the commission cycle.' }, 403)
  }

  const { data, error } = await supabase.rpc('run_commission_cycle')

  if (error) {
    console.error('run_commission_cycle failed:', error.message)
    return json({ error: error.message }, 500)
  }

  // RETURNS TABLE arrives as a single-row array.
  const result = Array.isArray(data) ? data[0] : data

  return json({
    released:         result?.released ?? 0,
    confirmed:        result?.confirmed ?? 0,
    total_value:      result?.total_value ?? 0,
    campaigns_paused: result?.paused ?? 0,
    held_back:        result?.held ?? 0,
  })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
