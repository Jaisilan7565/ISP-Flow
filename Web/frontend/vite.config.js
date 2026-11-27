import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    port: 2000,
    strictPort: true, // fail clearly if 2000 is taken instead of moving to another port
    open: false,
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:4000',
        changeOrigin: true
      },
      // Socket.io live sync
      '/socket.io': {
        target: process.env.API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
        ws: true
      }
    }
  }
});
