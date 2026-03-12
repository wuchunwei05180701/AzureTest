import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: 8079,
    host: '0.0.0.0',
    allowedHosts: ['uat.heph-ai.net', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        target: 'http://localhost:8180',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../backend/static'),
    emptyOutDir: true,
  },
})
