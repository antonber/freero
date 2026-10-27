import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// FREERO_API_PORT lets several dev setups run side by side (e.g. parallel verification).
const server = `http://localhost:${process.env.FREERO_API_PORT ?? 4000}`;
const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

// Leaving a board closes its live socket mid-write; Vite's ws proxy logs that as a red stack
// trace. Those two codes are expected disconnects, so keep them out of the dev console.
const logger = createLogger();
const logError = logger.error.bind(logger);
logger.error = (msg, opts) => {
  if (msg.includes('ws proxy socket error') && /ECONNABORTED|ECONNRESET/.test(`${msg} ${opts?.error?.message ?? ''}`)) return;
  logError(msg, opts);
};

export default defineConfig({
  plugins: [react()],
  customLogger: logger,
  resolve: {
    // Layer entry points. Features/app import '@engine' and '@ui' only — see ARCHITECTURE.md.
    alias: {
      '@engine': src('engine/index.ts'),
      '@ui': src('ui/index.ts'),
    },
  },
  server: {
    port: 5173,
    // Keep the browser's Host (changeOrigin: false): the server refuses state-changing requests
    // and socket upgrades whose Origin is not the Host they arrived on (CSRF defence).
    proxy: {
      '/api': { target: server, changeOrigin: false },
      '/uploads': { target: server, changeOrigin: false },
      '/ws': { target: server, ws: true, changeOrigin: false },
    },
  },
});
