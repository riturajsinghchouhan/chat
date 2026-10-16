import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development the API and Socket.IO are proxied, so cookies are same-origin.
    // Override with API_PROXY_TARGET=http://127.0.0.1:5001 if the backend runs elsewhere.
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:5000', changeOrigin: true },
      '/socket.io': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:5000', ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
  },
});
