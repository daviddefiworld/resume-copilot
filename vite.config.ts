import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// No dev proxy: the client calls the Node backend directly (see BASE in
// src/api.ts). CORS is enabled server-side, so the dev page on :3501 can reach
// the API on :3500 without Vite proxying — which also avoids the stale-socket
// proxy 500 that appeared after the app sat idle.
export default defineConfig({
  plugins: [react()]
});
