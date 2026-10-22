// Entry point for joincovo.app — the public site.
//
// The same Landing component the MVP serves, with VITE_WAITLIST_ONLY=true
// turning every call to action into a jump to the waitlist. See the note at
// the top of pages/Landing.jsx for why it is one component and not two.
//
// This entry exists so the public bundle does not CONTAIN the application at
// all. App.jsx could have rendered Landing alone behind the same flag, and the
// dashboards are lazy so they would never have been fetched — but their chunks
// would still have been built and uploaded, sitting on a public domain waiting
// for someone to guess a filename. Importing nothing but the landing page is a
// stronger guarantee than relying on nobody asking for the file.
//
// There is deliberately no AppProvider: Landing reads no session, and wrapping
// it in one would make the public site open an auth connection to Supabase on
// every visit for a value it never uses.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Landing from './pages/Landing'
import { Privacy, Terms, DataDeletion } from './pages/legal/LegalPages'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />

        {/* Kept public and reachable. Meta checks these before a Facebook app
            can go Live, Resend wants a reachable privacy policy on a verified
            sending domain, and the POPIA notice has to live somewhere a person
            who has not signed up can still read it. */}
        <Route path="/privacy"       element={<Privacy />} />
        <Route path="/terms"         element={<Terms />} />
        <Route path="/data-deletion" element={<DataDeletion />} />

        {/* Anything else — including /auth, /dashboard and /admin, which do not
            exist in this bundle — goes to the landing page rather than a blank
            screen. Someone following an old link lands somewhere useful. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
