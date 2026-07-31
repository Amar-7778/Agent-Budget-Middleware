import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '../static'),
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    proxy: {
      '/v1': 'http://localhost:8000',
      '/budgets': 'http://localhost:8000',
      '/dashboard': 'http://localhost:8000',
      '/demo': 'http://localhost:8000',
      '/audit': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
    }
  }
})
