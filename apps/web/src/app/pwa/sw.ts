// Freero's service worker (KAI-140). Built into /sw.js by the `freero-sw` plugin in vite.config.ts,
// which defines the build's version and the app-shell files to precache. Not bundled with the app.
//
// It caches the APP SHELL ONLY:
// - content-hashed build files (/assets/*) and a few static shell files (icons, manifest, the
//   offline page): cache first — a hashed file never changes, so it can never be stale;
// - page navigations: always the network (a deploy's new index.html is picked up on the next load,
//   so nobody runs stale code), the offline page when the network fails — never a cached page, so
//   the sign-in pages' responses are never stored either;
// - /api, /ws and /uploads (board data, sockets, people's files): never touched, never stored.
// Anything else (other origins: fonts, embeds) is left to the browser.

/** What the worker does with a request. */
export type Strategy = 'bypass' | 'navigate' | 'cache-first';

/** Static shell files served from the cache (besides /assets/*). */
export const SHELL_FILES = ['/offline.html', '/manifest.webmanifest', '/freero.svg', '/icons/icon-192.png', '/icons/icon-512.png'];
export const OFFLINE_PAGE = '/offline.html';
const CACHE_PREFIX = 'freero-shell-';
const NEVER = /^\/(api|ws|uploads)(\/|$)/;

export function strategyFor(req: { method: string; mode: string; url: string }, origin: string): Strategy {
  if (req.method !== 'GET') return 'bypass';
  const url = new URL(req.url);
  if (url.origin !== origin) return 'bypass';
  if (NEVER.test(url.pathname)) return 'bypass';
  if (req.mode === 'navigate') return 'navigate';
  if (url.pathname.startsWith('/assets/') || SHELL_FILES.includes(url.pathname)) return 'cache-first';
  return 'bypass';
}

/** A response that may be kept: a complete same-origin success that didn't ask not to be stored. */
export function cacheable(res: Response): boolean {
  return res.ok && res.status === 200 && (res.type === 'basic' || res.type === 'default') && !/no-store/i.test(res.headers.get('Cache-Control') ?? '');
}

export interface FetchEnv {
  fetch(req: Request): Promise<Response>;
  match(url: string | Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}

/** The response for `req`, or null to let the browser handle it (bypass). */
export function respond(req: Request, origin: string, env: FetchEnv): Promise<Response> | null {
  const strategy = strategyFor(req, origin);
  if (strategy === 'bypass') return null;
  if (strategy === 'navigate')
    return env.fetch(req).catch(async () => (await env.match(OFFLINE_PAGE)) ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }));
  return (async () => {
    const hit = await env.match(req);
    if (hit) return hit;
    const res = await env.fetch(req);
    if (cacheable(res)) await env.put(req, res.clone()).catch(() => undefined);
    return res;
  })();
}

// ---- the worker itself (only when running as one)

interface ExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(r: Promise<Response>): void;
}
interface WorkerScope {
  location: Location;
  registration: { scope: string };
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: string, cb: (e: Event & { data?: unknown }) => void): void;
}

declare const __FREERO_SW_VERSION__: string;
declare const __FREERO_SW_PRECACHE__: string[];

function install(scope: WorkerScope, version: string, precache: string[]) {
  const cacheName = `${CACHE_PREFIX}${version}`;
  const origin = scope.location.origin;

  scope.addEventListener('install', (e) => {
    (e as ExtendableEvent).waitUntil(
      caches.open(cacheName).then((cache) =>
        // One missing file must not fail the install (it is fetched on demand later).
        Promise.all(precache.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined))),
      ),
    );
  });

  scope.addEventListener('activate', (e) => {
    (e as ExtendableEvent).waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== cacheName).map((k) => caches.delete(k))))
        .then(() => scope.clients.claim()),
    );
  });

  // The page's "Reload" (app/pwa/register.ts) asks a waiting new version to take over.
  scope.addEventListener('message', (e) => {
    if ((e.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') void scope.skipWaiting();
  });

  scope.addEventListener('fetch', (e) => {
    const ev = e as FetchEvent;
    const res = respond(ev.request, origin, {
      fetch: (r) => fetch(r),
      match: (r) => caches.match(r, { cacheName }) as Promise<Response | undefined>,
      put: (r, v) => caches.open(cacheName).then((c) => c.put(r, v)),
    });
    if (res) ev.respondWith(res);
  });
}

if (typeof __FREERO_SW_VERSION__ === 'string' && typeof caches !== 'undefined' && !('document' in globalThis)) {
  install(globalThis as unknown as WorkerScope, __FREERO_SW_VERSION__, __FREERO_SW_PRECACHE__);
}
