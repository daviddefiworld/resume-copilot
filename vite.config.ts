import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client runs on port 3501 and proxies API requests to the Node backend on
// port 3500, so the frontend never needs to know the API origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3500'
    }
  }
});
