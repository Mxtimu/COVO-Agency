import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Typed with the generated Database schema. This is what makes a bad query a
// compile error instead of a runtime null: every .from(), .select() and .rpc()
// below is now checked against the real shape of the database.
//
// It is specifically what would have caught the PostgREST embed bugs. Every
// foreign key in this schema points at `profiles` — none point at
// `creator_profiles` or `brand_profiles` — so an embed like
// `creator_profiles(covo_score)` from `affiliate_links` can never resolve. It
// failed silently, returned null, and rendered an empty panel. With the
// schema in the types, that spelling does not compile.
//
// Regenerate after any migration:
//   npx supabase gen types typescript --project-id nyeulzucksldwlcrbbmo > src/lib/database.types.ts
export const supabase = createClient<Database>(url, key, {
  auth: {
    autoRefreshToken:    true,
    persistSession:      true,
    detectSessionInUrl:  true,
  },
})
