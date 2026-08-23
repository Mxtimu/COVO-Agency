import { createContext, useContext, useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

const Ctx = createContext(null)

export function AppProvider({ children }) {
  const { session, profile, loading } = useAuth()

  const [links,  setLinks]  = useState(() => JSON.parse(localStorage.getItem('covo_links') || '[]'))
  const [joined, setJoined] = useState([])

  // Sync joined campaigns from Supabase profile whenever it loads/changes
  useEffect(() => {
    const cp = Array.isArray(profile?.creator_profiles)
      ? profile.creator_profiles[0]
      : profile?.creator_profiles
    if (cp?.joined_campaign_ids) {
      setJoined(cp.joined_campaign_ids)
    }
  }, [profile])

  async function saveJoined(val) {
    setJoined(val)
    if (session?.user?.id) {
      await supabase.from('creator_profiles').upsert({
        id: session.user.id,
        joined_campaign_ids: val,
      })
    }
  }

  const persist = (key, setter) => (val) => {
    setter(val)
    localStorage.setItem('covo_' + key, JSON.stringify(val))
  }

  async function logout() {
    localStorage.removeItem('covo_links')
    setLinks([]); setJoined([])
    await supabase.auth.signOut()
  }

  const supaUser = session?.user ?? null
  const role     = profile?.role ?? null

  const legacyUser = supaUser ? {
    id:    supaUser.id,
    email: supaUser.email,
    first: profile?.full_name?.split(' ')[0] ?? supaUser.email.split('@')[0],
    last:  profile?.full_name?.split(' ').slice(1).join(' ') ?? '',
  } : null

  return (
    <Ctx.Provider value={{
      // Supabase-native
      session, profile, loading, role,
      isCreator: role === 'creator',
      isBrand:   role === 'brand',
      isAdmin:   role === 'admin',
      logout,

      // Legacy compat
      user:        legacyUser,
      saveUser:    () => {},
      saveProfile: () => {},
      links,  saveLinks: persist('links', setLinks),
      joined, saveJoined,
    }}>
    {children}
    </Ctx.Provider>
  )
}

export const useApp = () => useContext(Ctx)
