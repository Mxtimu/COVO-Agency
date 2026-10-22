import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { renameSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Build config for joincovo.app — the public site.
//
// Separate from vite.config.js so the public bundle is built from
// src/landing.jsx, which imports the landing page and the legal pages and
// nothing else. The dashboards and admin panels are not merely unreachable
// in this build, they are not in it: no chunk for them is emitted, so there
// is no file on the public domain for anyone to find.
//
// Output goes to dist-landing/ rather than dist/ so the two builds cannot
// overwrite each other — running one must never leave the other's output
// half-replaced on disk.
// Rollup names the output after the input, so `landing.html` as the entry
// produces `dist-landing/landing.html`. Cloudflare Pages (and every other
// static host) serves `index.html` for `/`, so the site would deploy
// successfully and then 404 on its own home page.
//
// Done in closeBundle, on disk. A generateBundle rename looks tidier but does
// not work: Vite's own HTML plugin writes the document after that hook, so the
// renamed entry is simply overwritten and the build output looks unchanged —
// which is exactly how this was missed the first time.
const emitAsIndexHtml = {
  name: 'emit-as-index-html',
  closeBundle() {
    const from = resolve(__dirname, 'dist-landing/landing.html')
    const to   = resolve(__dirname, 'dist-landing/index.html')
    if (!existsSync(from)) {
      this.warn('dist-landing/landing.html not found — nothing renamed')
      return
    }
    renameSync(from, to)
  },
}

export default defineConfig({
  plugins: [react(), emitAsIndexHtml],

  // Set here rather than passed in as an environment variable.
  //
  // This config exists only to build the public site, so the flag is not a
  // choice the caller should be able to get wrong — and getting it wrong is
  // quiet: the build succeeds and produces a landing page with working Log in
  // and Get Started buttons pointing at /auth, a route this bundle does not
  // contain. Every button would bounce the visitor back to the home page.
  //
  // It also means the deploy script needs no cross-platform way to set an env
  // var, which on Windows would have meant adding a dependency for one word.
  define: {
    'import.meta.env.VITE_WAITLIST_ONLY': '"true"',
  },
  build: {
    outDir: 'dist-landing',
    emptyOutDir: true,
    rollupOptions: {
      input: 'landing.html',
      output: {
        // Same split as the app build: vendor code cached separately from
        // page code, so a copy change does not invalidate React for every
        // returning visitor.
        manualChunks: {
          react:    ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})
