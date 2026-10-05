import { supabase } from '../supabase'

const CALLBACK_URL = `${window.location.origin}/auth/callback`

// ── OAuth sign-in ─────────────────────────────────────────────────────────
//
// Which providers the UI offers. `enabled` is the switch: flip it the moment
// the provider is actually configured under Authentication → Providers in
// Supabase, and not before.
//
// It exists because an unconfigured provider does not fail quietly — Supabase
// redirects back to /auth with "Unsupported provider: provider is not
// enabled", so a creator who clicks it is bounced to an error they can do
// nothing about. Better to show two working buttons than three where one is a
// trapdoor.
//
// TikTok and Instagram are deliberately absent and always will be: Supabase
// has no provider for either ("Provider tiktok could not be found"), so they
// cannot be sign-in options at all. They belong in account connection, where
// the point is reading someone's audience rather than identifying them.
export const OAUTH_PROVIDERS = [
  { id: 'google',   label: 'Google',   enabled: true  },
  // Configured in Supabase on 2026-10-01 and verified live: the authorize
  // endpoint now redirects to facebook.com/dialog/oauth rather than answering
  // "provider is not enabled".
  { id: 'facebook', label: 'Facebook', enabled: true  },
  // Still unconfigured. Flip this once the X developer app's credentials are
  // in Supabase — the authorize endpoint is the way to check, not the
  // dashboard: it answers "provider is not enabled" until it is really on.
  { id: 'twitter',  label: 'X',        enabled: false },
]

export const ENABLED_PROVIDERS = OAUTH_PROVIDERS.filter(p => p.enabled)

// Google is asked for offline access so the refresh token survives; the
// others take the defaults.
const PROVIDER_OPTIONS = {
  google: { queryParams: { access_type: 'offline', prompt: 'consent' } },
}

// ── Carrying the account type across an OAuth redirect ────────────────────
//
// handle_new_user() reads the role from raw_user_meta_data.user_type, which
// the email signup forms set. OAuth cannot: Supabase fills that column from
// the provider, and Google and Facebook send a name, an email and an avatar.
// So every social sign-up fell through to 'creator', and
// guard_profile_privileges then refused to change it — a brand who clicked
// "Continue with Google" became a creator permanently and was sent to creator
// onboarding. The picker on /auth was collecting the answer and dropping it.
//
// The answer is parked here before the redirect and claimed on the way back
// (claim_account_role, role_claim.sql). It is NOT sent to the provider or put
// in the OAuth state: a role the browser supplies is the thing the schema
// guards against, so the account is still created as a creator and the change
// is a separate, once-only, server-checked act.
//
// localStorage rather than sessionStorage because the round trip can come
// back in a different tab — Facebook's in-app browser does exactly that — and
// a sessionStorage key would be gone. The timestamp keeps a stale answer from
// an abandoned attempt weeks ago from being applied to a later signup.
const PENDING_ROLE_KEY = 'covo.pendingRole'
const PENDING_ROLE_TTL = 30 * 60 * 1000

export function setPendingRole(role) {
  if (role !== 'creator' && role !== 'brand') return
  try {
    localStorage.setItem(PENDING_ROLE_KEY, JSON.stringify({ role, at: Date.now() }))
  } catch {
    // Private browsing, or storage disabled. The sign-in still works; the
    // person lands as a creator and can pick their type on the next screen.
  }
}

export function takePendingRole() {
  try {
    const raw = localStorage.getItem(PENDING_ROLE_KEY)
    if (!raw) return null
    localStorage.removeItem(PENDING_ROLE_KEY)
    const { role, at } = JSON.parse(raw)
    if (Date.now() - at > PENDING_ROLE_TTL) return null
    return role === 'creator' || role === 'brand' ? role : null
  } catch {
    return null
  }
}

// Settles a brand-new account's type. Returns { claimed, role, outcome } —
// `outcome` is a sentence to show when it refused, which happens when the
// account already has activity or has been settled before.
export async function claimAccountRole(role) {
  const { data, error } = await supabase.rpc('claim_account_role', { p_role: role })
  if (error) return { claimed: false, role: null, outcome: error.message, error }
  // RETURNS TABLE comes back as an array of one row.
  const row = Array.isArray(data) ? data[0] : data
  return { claimed: !!row?.claimed, role: row?.role ?? null, outcome: row?.outcome ?? null }
}

export async function myRoleClaimStatus() {
  const { data, error } = await supabase.rpc('my_role_claim_status')
  if (error) return { role: null, claimable: false, reason: error.message, error }
  const row = Array.isArray(data) ? data[0] : data
  return { role: row?.role ?? null, claimable: !!row?.claimable, reason: row?.reason ?? null }
}

export async function signInWithProvider(providerId, intendedRole) {
  const provider = OAUTH_PROVIDERS.find(p => p.id === providerId)

  if (!provider?.enabled) {
    return { data: null, error: { message: `${provider?.label ?? 'That provider'} sign-in is not available yet.` } }
  }

  if (intendedRole) setPendingRole(intendedRole)

  return supabase.auth.signInWithOAuth({
    provider: providerId,
    options: { redirectTo: CALLBACK_URL, ...(PROVIDER_OPTIONS[providerId] ?? {}) },
  })
}

// Kept as named wrappers so existing call sites keep working.
export const signInWithGoogle   = () => signInWithProvider('google')
export const signInWithFacebook = () => signInWithProvider('facebook')
export const signInWithX        = () => signInWithProvider('twitter')

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

// ── Linking a social login to an account that already exists ──────────────
//
// Brands sign up by email on purpose: the form collects a first and last
// name, and an OAuth sign-up would hand us the provider's display name
// instead. But a brand who has already signed up should not be stuck typing
// a password forever, so they can attach Google or Facebook afterwards and
// use it to sign in.
//
// This is linkIdentity, not signInWithOAuth. The difference matters: the
// first attaches the provider to the signed-in user, the second would create
// a SECOND account on that provider's email and leave them with two.
//
// Requires "Allow manual linking" under Authentication → Settings in the
// Supabase dashboard. Without it every call comes back
// `manual_linking_disabled`, which is reported as such below rather than as
// a generic failure, because it is a dashboard toggle and not a code fault.

export async function listLinkedIdentities() {
  const { data, error } = await supabase.auth.getUserIdentities()
  if (error) return { identities: [], error }
  return { identities: data?.identities ?? [], error: null }
}

export async function linkProvider(providerId, returnTo) {
  const provider = OAUTH_PROVIDERS.find(p => p.id === providerId)
  if (!provider?.enabled) {
    return { error: { message: `${provider?.label ?? 'That provider'} is not available yet.` } }
  }

  // `next` brings them back to the page they started from instead of the
  // dashboard root. AuthCallback only honours internal paths.
  const redirectTo = returnTo
    ? `${CALLBACK_URL}?next=${encodeURIComponent(returnTo)}`
    : CALLBACK_URL

  const { data, error } = await supabase.auth.linkIdentity({
    provider: providerId,
    options: { redirectTo },
  })
  return { data, error }
}

export async function unlinkProvider(identity) {
  const { error } = await supabase.auth.unlinkIdentity(identity)
  return { error }
}

// The provider errors worth saying something specific about. Everything else
// falls through to the message Supabase gave.
export function identityErrorMessage(error, providerLabel = 'that provider') {
  if (!error) return ''
  const code = error.code ?? ''
  const msg  = typeof error.message === 'string' ? error.message : ''

  if (code === 'manual_linking_disabled' || /manual linking/i.test(msg)) {
    return 'Linking is switched off for this project. Enable "Allow manual linking" under Authentication → Settings in Supabase.'
  }

  // The common one, and the confusing one: that social account is already
  // its own COVO user. One provider identity belongs to exactly one account,
  // so the fix is to use a different social account, not to try again.
  if (code === 'identity_already_exists' || /already.*(linked|exists|registered)/i.test(msg)) {
    return `That ${providerLabel} account is already used by another COVO account. Each social login belongs to one account, so use a different one here.`
  }

  if (code === 'single_identity_not_deletable' || /last identity/i.test(msg)) {
    return 'This is the only way left to sign in, so it cannot be removed. Add another first.'
  }

  return msg || 'Something went wrong. Please try again.'
}
