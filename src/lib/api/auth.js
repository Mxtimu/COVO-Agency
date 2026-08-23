import { supabase } from '../supabase'

const CALLBACK_URL = `${window.location.origin}/auth/callback`

// ── Creator: OAuth only (Google / Facebook / TikTok) ──────────────────────
export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: CALLBACK_URL,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  })
}

export async function signInWithFacebook() {
  return supabase.auth.signInWithOAuth({
    provider: 'facebook',
    options: { redirectTo: CALLBACK_URL },
  })
}

// ── Creator: email + password ─────────────────────────────────────────────
export async function signUpCreator({ email, password, fullName }) {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: CALLBACK_URL,
      data: {
        user_type: 'creator',
        full_name: fullName,
      },
    },
  })
}

export async function signInCreator({ email, password }) {
  return supabase.auth.signInWithPassword({ email, password })
}

// ── Brand: email + password ────────────────────────────────────────────────
export async function signUpBrand({ email, password, fullName, companyName }) {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: CALLBACK_URL,
      data: {
        user_type:    'brand',
        full_name:    fullName,
        company_name: companyName,
      },
    },
  })
}

export async function signInBrand({ email, password }) {
  return supabase.auth.signInWithPassword({ email, password })
}

// ── Shared ─────────────────────────────────────────────────────────────────
export async function signOut() {
  return supabase.auth.signOut()
}

// With email confirmation enabled, Supabase does not reveal that an address is
// already taken — it returns a stub user with an empty identities array instead
// of an error. Detect that so signup doesn't silently look like a success.
export function isExistingUser(data) {
  return Array.isArray(data?.user?.identities) && data.user.identities.length === 0
}

const ERROR_COPY = {
  invalid_credentials:        'Incorrect email or password. If you just signed up, confirm your email address first.',
  email_not_confirmed:        'Please confirm your email address — check your inbox for the link we sent you.',
  user_already_exists:        'An account with this email already exists. Try signing in instead.',
  email_exists:               'An account with this email already exists. Try signing in instead.',
  weak_password:              'That password is too weak. Use at least 8 characters.',
  over_email_send_rate_limit: 'Too many emails have been sent to this address. Please wait an hour and try again.',
  over_request_rate_limit:    'Too many attempts. Please wait a moment and try again.',
  signup_disabled:            'New sign-ups are currently disabled.',
  validation_failed:          'Please check the details you entered and try again.',
}

// supabase-js turns gateway errors (500/502/504…) into an AuthRetryableFetchError
// whose message is JSON.stringify(response) — the literal string '{}'. Never put
// that in front of a user.
export function authErrorMessage(error) {
  if (!error) return ''
  if (import.meta.env.DEV) console.error('[auth]', error)

  const copy = ERROR_COPY[error.code]
  if (copy) return copy

  const msg = typeof error.message === 'string' ? error.message.trim() : ''

  // Supabase returns a 500 when the confirmation email cannot be delivered,
  // and rolls the auth.users row back with it — verified by signing the same
  // address up twice and getting 500 both times rather than "already exists".
  // So no account is created and the address stays free to retry. Saying the
  // service is down would be wrong; so would implying the account exists.
  if (/confirmation email|error sending/i.test(msg)) {
    return 'We could not send your confirmation email, so your account was not created. Please try again shortly, or contact support@covo.africa if it keeps happening.'
  }

  if (error.name === 'AuthRetryableFetchError' || !msg || msg === '{}') {
    return error.status === 0
      ? "Couldn't reach the server. Check your connection and try again."
      : 'The authentication service is temporarily unavailable. Please try again in a moment.'
  }
  return msg
}

export async function resetPassword(email) {
  return supabase.auth.resetPasswordForEmail(email, { redirectTo: CALLBACK_URL })
}
