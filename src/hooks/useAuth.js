import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useAuth() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Register onAuthStateChange FIRST — it handles the PKCE code exchange
    // that happens when Google/Facebook redirects back to /auth/callback
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    // getSession handles already-logged-in users on non-callback pages
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSession(session)
        fetchProfile(session.user.id)
      } else {
        // On the OAuth callback page, don't set loading=false yet —
        // onAuthStateChange will fire once the code exchange completes
        const isCallback = window.location.pathname.includes('/auth/callback')
        if (!isCallback) setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId, isRetry = false) {
    setLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('*, creator_profiles(*), brand_profiles(*)')
      .eq('id', userId)
      .single()

    if (data) {
      setProfile(data)
      setLoading(false)
      return
    }

    // No profile row. Either the signup trigger hasn't committed yet, or the
    // user was deleted while their JWT is still valid — a deleted user stays
    // "logged in" otherwise, since the token remains cryptographically sound
    // until it expires. Retry once to cover the trigger, then sign out.
    if (!isRetry) {
      setTimeout(() => fetchProfile(userId, true), 1200)
      return
    }

    await supabase.auth.signOut()
    setProfile(null)
    setSession(null)
    setLoading(false)
  }

  return { session, profile, loading }
}
