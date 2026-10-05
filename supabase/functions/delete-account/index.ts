import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Closing your own account.
//
// Deliberately not auth.admin.deleteUser(). profiles.id references
// auth.users ON DELETE CASCADE and commissions.creator_id references
// profiles ON DELETE CASCADE, so deleting the auth user would take every
// commission that creator ever earned with it — rows that are also the
// record of what a brand's escrow paid for and what COVO charged a fee on.
// One person's erasure would silently rewrite someone else's accounts.
//
// So: the personal data is overwritten, the ledger keeps its shape, and the
// auth user is banned rather than removed. They cannot sign in, their email
// is gone, and nothing they earned stops adding up for the brand that owes
// it.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// A hundred years. Supabase has no permanent ban, and an expiry nobody alive
// will see is the same thing in practice.
const FOREVER = '876000h'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return json({ error: 'Not authenticated' }, 401)

    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: userError } = await caller.auth.getUser()
    if (userError || !user) return json({ error: 'Not authenticated' }, 401)

    // Typing the phrase is the confirmation. A dialog someone clicks through
    // on reflex is not consent to something irreversible.
    const body = await req.json().catch(() => ({}))
    if (String(body.confirm ?? '').trim().toUpperCase() !== 'DELETE') {
      return json({ error: 'Type DELETE to confirm.' }, 400)
    }

    // ── Refuse while money is in flight ─────────────────────────────
    const { data: blockers, error: blockerError } = await supabase
      .rpc('account_deletion_blockers', { p_user: user.id })

    if (blockerError) throw new Error(`blocker check: ${blockerError.message}`)

    if (Array.isArray(blockers) && blockers.length > 0) {
      return json({
        error: 'This account cannot be closed yet.',
        blockers: blockers.map((b: { blocker: string; detail: string }) => ({
          code: b.blocker, detail: b.detail,
        })),
      }, 409)
    }

    // ── Erase the person ────────────────────────────────────────────
    const { data, error } = await supabase.rpc('anonymise_account', { p_user: user.id })
    if (error) throw new Error(`anonymise_account: ${error.message}`)

    const result = Array.isArray(data) ? data[0] : data
    if (!result?.anonymised) {
      return json({ error: result?.outcome ?? 'Could not close the account.' }, 409)
    }

    // ── Take away the way back in ───────────────────────────────────
    // After this the email is free for someone else to sign up with, and
    // the old token is refused at the gate rather than only by RLS.
    const { error: banError } = await supabase.auth.admin.updateUserById(user.id, {
      email:        `deleted+${user.id.slice(0, 8)}@covo.invalid`,
      ban_duration: FOREVER,
    })

    if (banError) {
      // The data is already gone, which is the part that matters and the
      // part that cannot be undone. Say so plainly rather than reporting a
      // failure that would invite them to try again.
      console.error(`account ${user.id} anonymised but not banned:`, banError.message)
      return json({
        closed: true,
        warning: 'Your details have been removed, but sign-in may take a little longer to disable. Contact support@covo.africa if you can still sign in tomorrow.',
      })
    }

    console.log(`account ${user.id} closed and anonymised`)
    return json({ closed: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('delete-account failed:', message)
    return json({ error: 'Could not close the account. Please try again.' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
