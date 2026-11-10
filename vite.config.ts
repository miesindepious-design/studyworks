import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Where the dev server proxies API/auth/ws traffic. Override with
// VITE_PROXY_TARGET=https://your-deployment.vercel.app to run the local
// client against a live deployment (handy for UI checks).
const API_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/auth': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/ws': {
        target: API_TARGET,
        ws: true,
        changeOrigin: true,
      },
      // Voice chat signaling — the standalone voice server mounts Socket.IO
      // at /socket.io/voice. Proxied so local dev works against the same
      // origin without extra configuration.
      '/socket.io/voice': {
        target: 'http://localhost:3002',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
