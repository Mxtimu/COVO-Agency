import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// The confirmation logic lives in the database (confirm_due_commissions in
// supabase/commission_cron.sql) and runs there on a pg_cron schedule. This
// endpoint exists only so an admin can trigger a run on demand — it calls the
// same function rather than reimplementing it, so the two can never drift.
serve(async (_req) => {
  const { data, error } = await supabase.rpc('confirm_due_commissions')

  if (error) {
    console.error('confirm_due_commissions failed:', error.message)
    return json({ error: error.message }, 500)
  }

  // RETURNS TABLE arrives as a single-row array.
  const result = Array.isArray(data) ? data[0] : data

  return json({
    confirmed:        result?.confirmed_count ?? 0,
    total_value:      result?.total_value ?? 0,
    campaigns_paused: result?.campaigns_paused ?? 0,
  })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
