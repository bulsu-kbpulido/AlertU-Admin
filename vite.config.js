import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const configuredBackend = (
    env.VITE_API_URL ||
    'https://alertu-server-production.up.railway.app'
  ).trim();

  // Vite proxy receives /api from the browser, so its target must be the
  // backend origin, not the origin plus /api.
  const backendOrigin = configuredBackend
    .replace(/\/+$/, '')
    .replace(/\/api$/i, '');

console.log('Configured backend:', configuredBackend);
console.log('Backend origin:', backendOrigin);

  return {
    plugins: [react(), tailwindcss()],

    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },

    server: {
      host: true,
      proxy: {
        '/api': {
          target: backendOrigin,
          changeOrigin: true,
          secure: true,
          ws: true,
        },
        '/socket.io': {
          target: backendOrigin,
          changeOrigin: true,
          secure: true,
          ws: true,
        },
      },
    },
  };
});
