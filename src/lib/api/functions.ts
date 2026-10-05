import { supabase } from '../supabase'

// Calling an Edge Function and getting back what it actually said.
//
// supabase-js rejects any non-2xx as a FunctionsHttpError whose `message` is
// the generic "Edge Function returned a non-2xx status code", and puts the
// real response on `error.context`. So a function that carefully answers
// `400 {"error": "Account number is invalid"}` reaches the user as a string
// that says nothing — the error is delivered and then discarded one layer
// short of being read.
//
// This reads the body back out, so the reason the function gave is the reason
// the user sees.
export async function invokeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>,
): Promise<{ data: T | null; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession()

  // Without this the Authorization header goes out as "Bearer undefined" and
  // every function answers 401 — which reads as "you are not allowed" when
  // the truth is the session had not loaded yet.
  if (!session?.access_token) {
    return { data: null, error: 'Your session has expired. Please sign in again.' }
  }

  const { data, error } = await supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  })

  if (error) {
    const detail = await readErrorBody(error)
    if (import.meta.env.DEV) console.error(`[${name}]`, detail ?? error.message, error)
    return { data: null, error: detail ?? 'Something went wrong. Please try again.' }
  }

  // A function can also answer 200 with an { error } payload.
  if (data && typeof data === 'object' && 'error' in data) {
    return { data: null, error: String((data as { error: unknown }).error) }
  }

  return { data: data as T, error: null }
}

// FunctionsHttpError carries the Response on .context. It can only be read
// once, and it may not be JSON at all — a platform-level failure comes back
// as plain text.
async function readErrorBody(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown })?.context
  if (!(context instanceof Response)) return null

  try {
    const text = await context.text()
    if (!text) return null
    try {
      const parsed = JSON.parse(text)
      return parsed?.error ?? parsed?.message ?? text.slice(0, 300)
    } catch {
      return text.slice(0, 300)
    }
  } catch {
    return null
  }
}
