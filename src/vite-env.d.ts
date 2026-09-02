/// <reference types="vite/client" />

// Vite exposes these on import.meta.env at build time. Declaring them means a
// typo in a variable name is a compile error rather than an undefined that
// only surfaces as a broken Supabase client at runtime.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_EMAILJS_SERVICE_ID: string
  readonly VITE_EMAILJS_TEMPLATE_ID: string
  readonly VITE_EMAILJS_PUBLIC_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
