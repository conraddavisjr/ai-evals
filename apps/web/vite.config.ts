import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // the architecture map's data and engine live in docs/ so the standalone pages share them
    alias: { '@arch': fileURLToPath(new URL('../../docs/architecture', import.meta.url)) },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:4747', changeOrigin: true },
      '/mcp': { target: 'http://localhost:4747', changeOrigin: true },
    },
  },
})
