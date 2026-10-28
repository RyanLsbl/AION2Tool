import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Die Oberfläche liegt in src/web und wird nach dist/web gebaut.
// Im Entwicklungsmodus (npx vite) werden /api und /auth an den Node-Server weitergereicht.
export default defineConfig({
  root: 'src/web',
  publicDir: '../../public',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
    },
  },
});
