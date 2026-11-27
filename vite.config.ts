import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Where the dev server proxies API/auth/ws traffic. Override with
// VITE_PROXY_TARGET=https://your-deployment.vercel.app to run the local
// client against a live deployment (handy for UI checks).
const API_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:3001';

// When building inside Tauri (desktop app), the frontend is loaded from the
// filesystem as a file:// URL, so Vite's dev-server proxy is not available.
// TAURI_ENV_DEBUG is set by `tauri dev`; its absence means a normal web build.
const isTauri = process.env.TAURI_ENV_DEBUG !== undefined
  || process.env.TAURI_ENV_TARGET_TRIPLE !== undefined;

export default defineConfig({
  plugins: [react()],

  // Tauri expects the built assets in ../dist relative to src-tauri.
  // This is already the default; stated explicitly for clarity.
  build: {
    outDir: 'dist',
    // Smaller chunks load faster inside the native webview.
    chunkSizeWarningLimit: 2000,
  },

  // prevent vite from obscuring rust errors
  clearScreen: false,

  server: {
    // Tauri expects a fixed port; fail if it's taken.
    port: 5173,
    strictPort: isTauri,
    // Let Tauri's webview connect from a different origin in dev.
    ...(isTauri ? { host: '127.0.0.1' } : {}),
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

  // Env variables prefixed VITE_ are exposed to the browser bundle.
  // TAURI_ENV_* are injected by the Tauri CLI — expose the ones the app
  // needs so runtime code can detect "am I running as a desktop app?".
  envPrefix: ['VITE_', 'TAURI_ENV_'],
});
