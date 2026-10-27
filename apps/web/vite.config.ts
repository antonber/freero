import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// FREERO_API_PORT lets several dev setups run side by side (e.g. parallel verification).
const server = `http://localhost:${process.env.FREERO_API_PORT ?? 4000}`;
const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Layer entry points. Features/app import '@engine' and '@ui' only — see ARCHITECTURE.md.
    alias: {
      '@engine': src('engine/index.ts'),
      '@ui': src('ui/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/uploads': server,
      '/ws': { target: server, ws: true },
    },
  },
});
