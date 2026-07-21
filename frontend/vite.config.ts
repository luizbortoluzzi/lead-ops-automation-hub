import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// During `npm run dev`, proxy API calls to the backend so the browser stays
// same-origin (no CORS). Override the target with VITE_DEV_PROXY when the
// backend runs on a non-default host port (e.g. http://localhost:3010).
const proxyTarget = process.env.VITE_DEV_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: proxyTarget, changeOrigin: true },
      '/health': { target: proxyTarget, changeOrigin: true },
    },
  },
});
