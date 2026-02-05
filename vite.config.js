import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // This proxy ONLY works on your laptop (npm run dev).
    // It is IGNORED by Vercel in production.
    proxy: {
      '/api': {
        target: 'http://localhost:3001' || "https://eduproback.onrender.com",
        changeOrigin: true,
        secure: false,
      }
    }
  }
})