import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@bluecollar/shared': path.resolve(__dirname, 'shared/src/index.ts') },
    // shared/ imports zod; always use the web app's single copy.
    dedupe: ['zod', 'react', 'react-dom'],
  },
  build: {
    target: 'es2022',
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@supabase')) return 'supabase'
          if (id.includes('node_modules/socket.io-client') || id.includes('node_modules/engine.io')) return 'realtime'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
          return undefined
        },
      },
    },
  },
})
