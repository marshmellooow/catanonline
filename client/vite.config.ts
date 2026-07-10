import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-Server proxied /ws → autoritativer WebSocket-Server (Port 8787),
// damit Client & Server unter einer Origin laufen (teilbare ?room=CODE-Links,
// auch im LAN). fs.allow gibt Zugriff auf das @catan/shared-Quellpaket.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
    fs: { allow: ['..'] },
  },
  preview: { port: 5173 },
});
