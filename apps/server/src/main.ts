// Composition root. Discovers modules/<name>/ by reserved files — there is no module list to edit.
//   migrations/<YYYYMMDDHHMM>_<name>.sql  applied at startup (all modules, global timestamp order,
//               once each, tracked in _migrations) before anything else
//   routes.ts   export default (ctx) => express.Router; mounted at `export const mountPath` (default '/api')
//   ws.ts       export default (ctx) => WsRoute | WsRoute[]
//   init.ts     export default (ctx) => void | Promise<void>; runs after routes are mounted, before listen
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express, { type Router } from 'express';
import { ConfigError, loadConfig } from './platform/config';
import { createContext, type ServerContext } from './platform/context';
import { closeDb, DatabaseStartupError, discoverMigrations, migrate, openDb, redactUrl } from './platform/db';
import { apiNotFound, createApp, errorHandler } from './platform/http';
import { log, logError } from './platform/log';
import { rateLimit } from './platform/rateLimit';
import { drain, startPlatform, stopPlatform } from './platform/runtime';
import { attachWebSockets, type WsRoute } from './platform/ws';

const MODULES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'modules');

type RoutesModule = { default: (ctx: ServerContext) => Router | Promise<Router>; mountPath?: string };
type WsModule = { default: (ctx: ServerContext) => WsRoute | WsRoute[] };
type InitModule = { default: (ctx: ServerContext) => void | Promise<void> };

function moduleDirs(): string[] {
  return fs
    .readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** Imports modules/<name>/<file> if it exists. */
async function reserved<T>(name: string, file: string): Promise<T | null> {
  const p = path.join(MODULES_DIR, name, file);
  return fs.existsSync(p) ? ((await import(pathToFileURL(p).href)) as T) : null;
}

async function main(): Promise<void> {
  const config = loadConfig();
  startPlatform(config);
  const ctx = createContext(config);
  const names = moduleDirs();

  // Fail fast (before listening) when the database is unreachable or a migration fails.
  await openDb(config.databaseUrl ? { url: config.databaseUrl, poolSize: config.dbPoolMax } : { pgliteDir: config.pgliteDir });
  const applied = await migrate(discoverMigrations(MODULES_DIR));
  log(
    `database: ${config.databaseUrl ? `postgres ${redactUrl(config.databaseUrl)}` : `pglite ${config.pgliteDir}`}; ` +
      (applied.length ? `applied ${applied.join(', ')}` : 'schema up to date'),
  );

  const app = createApp(config);
  app.use('/api', rateLimit('api'));
  const wsRoutes: WsRoute[] = [];
  for (const name of names) {
    const routes = await reserved<RoutesModule>(name, 'routes.ts');
    if (routes) app.use(routes.mountPath ?? '/api', await routes.default(ctx));
    const ws = await reserved<WsModule>(name, 'ws.ts');
    if (ws) wsRoutes.push(...[ws.default(ctx)].flat());
  }
  app.use('/api', apiNotFound());

  // Production: serve the built web app with an SPA fallback.
  const indexHtml = path.join(config.webDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    // Vite's /assets are content-hashed: cache forever. Everything else (index.html) revalidates.
    app.use('/assets', express.static(path.join(config.webDist, 'assets'), { index: false, immutable: true, maxAge: '1y' }));
    app.use(express.static(config.webDist, { index: false, maxAge: 0 }));
    // App pages (boards, share and invite links, sign-in) are never search results: the marketing
    // site (modules/site) is what search engines index.
    app.get(/^(?!\/(api|uploads|ws)(\/|$)).*/, (_req, res) => {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.sendFile(indexHtml);
    });
    log(`serving web app from ${config.webDist}`);
  }
  app.use(errorHandler());

  for (const name of names) {
    const init = await reserved<InitModule>(name, 'init.ts');
    if (init) await init.default(ctx);
  }

  const server = http.createServer(app);
  const sockets = attachWebSockets(server, wsRoutes, { app, config });
  await new Promise<void>((resolve) => server.listen(config.port, resolve));
  log(`server listening on http://localhost:${config.port} (data: ${config.dataDir}; modules: ${names.join(', ')})`);

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal}: shutting down`);
    await drain(config);
    sockets.close();
    server.close();
    await ctx.shutdown(); // realtime saves every loaded doc here
    await stopPlatform();
    await closeDb(); // only after everything that writes has finished
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

main().catch((err) => {
  if (err instanceof ConfigError) console.error(err.message);
  else if (err instanceof DatabaseStartupError) console.error(`Freero cannot start: ${err.message}`);
  else logError('failed to start', err);
  process.exit(1);
});
