import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// In development the React app (port 5173) forwards /api calls to the Express API (port 5000),
// so the browser sees ONE origin and the session cookie can stay SameSite=Lax.
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:5000', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    css: false,
    globals: false,
  },
});
