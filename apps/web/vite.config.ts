import { createLogger, defineConfig, transformWithEsbuild, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

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

/**
 * Builds the service worker (src/app/pwa/sw.ts) into dist/sw.js — at the root, so it controls the
 * whole app — with this build's version and its app shell to precache: the entry's hashed JS and
 * CSS plus the static shell files. A new build = a new version = a fresh cache (old ones deleted on
 * activation). Hand-written, no service-worker library.
 */
function freeroServiceWorker(): Plugin {
  const source = src('app/pwa/sw.ts');
  return {
    name: 'freero-sw',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const shell = new Set<string>();
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk' || !out.isEntry) continue;
        shell.add(out.fileName);
        for (const f of out.imports) shell.add(f);
        for (const f of out.viteMetadata?.importedCss ?? []) shell.add(f);
      }
      const precache = ['/offline.html', '/manifest.webmanifest', '/freero.svg', '/icons/icon-192.png', '/icons/icon-512.png', ...[...shell].sort().map((f) => `/${f}`)];
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      const { code } = await transformWithEsbuild(readFileSync(source, 'utf8'), source, {
        loader: 'ts',
        format: 'iife',
        minify: true,
        define: { __FREERO_SW_VERSION__: JSON.stringify(version), __FREERO_SW_PRECACHE__: JSON.stringify(precache) },
      });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `// Freero service worker ${version}\n${code}` });
    },
  };
}

export default defineConfig({
  plugins: [react(), freeroServiceWorker()],
  customLogger: logger,
  resolve: {
    // Layer entry points. Features/app import '@engine' and '@ui' only — see ARCHITECTURE.md.
    alias: {
      '@engine': src('engine/index.ts'),
      '@ui': src('ui/index.ts'),
    },
  },
  // Pre-bundle at startup what is only discovered when a board opens, so the first board load in
  // dev doesn't re-optimize and reload: lucide's per-icon list (lazy icon library) and every
  // Yjs-family entry the store imports — optimizing those late splits them from the already
  // bundled `yjs`, which then loads twice ("Yjs was already imported") and breaks sync checks.
  optimizeDeps: {
    include: [
      'lucide-react/icons/index',
      'yjs',
      'y-websocket',
      'y-protocols/sync',
      'y-protocols/awareness',
      'lib0/encoding',
      'lib0/decoding',
      // The doc editor (KAI-162) binds to the same yjs through y-prosemirror: bundled together.
      'y-prosemirror',
      '@blocknote/core',
      '@blocknote/core/yjs',
      '@blocknote/react',
      '@blocknote/ariakit',
    ],
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
