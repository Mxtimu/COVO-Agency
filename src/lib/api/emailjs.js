import emailjs from '@emailjs/browser'
import { supabase } from '../supabase'

const SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID
const PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY

// Password reset goes through Supabase only. The reset link carries a token
// that Supabase generates and never exposes to the client, so EmailJS has no
// way to send a working link — branding these emails means configuring custom
// SMTP under Authentication → Emails, not sending a second message here.
export async function sendPasswordReset(email) {
  const redirectTo = `${window.location.origin}/auth/callback?type=recovery`
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  return { error }
}

// Contact form → covodeveloper@gmail.com (the "to" address is fixed in the
// EmailJS template; the vars below fill in {{name}}, {{email}}, {{message}}).
export async function sendContactMessage({ name, email, message }) {
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
    return { error: { message: 'Email service is not configured.' } }
  }
  try {
    await emailjs.send(SERVICE_ID, TEMPLATE_ID, { name, email, message }, PUBLIC_KEY)
    return { error: null }
  } catch (e) {
    return { error: { message: e?.text || 'Could not send your message.' } }
  }
}
