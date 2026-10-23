import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Fixed port so the app's localStorage (which is per-origin) is always at the same address.
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
})
