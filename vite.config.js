import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    historyApiFallback: true,
  },
  build: {
    rollupOptions: {
      output: {
        // Everything shipped as one 570 kB file, so a visitor landing on the
        // marketing page downloaded all three dashboards and every admin
        // panel before it rendered. The routes are lazy-loaded in App.jsx;
        // this splits the dependencies they share out of the entry chunk so
        // the split is not undone by React and Supabase riding along with it.
        //
        // Vendor code is cached separately from app code, so shipping a copy
        // change no longer invalidates 150 kB of React for every returning
        // visitor.
        manualChunks: {
          react:    ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})
