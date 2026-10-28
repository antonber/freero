import { describe, expect, it } from 'vitest';
import { respond, type FetchEnv } from './sw';

const ORIGIN = 'https://freero.example';

/** A cache + network double that records what the worker stored and fetched. */
function env(network: (req: Request) => Response | Promise<Response>) {
  const cache = new Map<string, Response>();
  const fetched: string[] = [];
  const e: FetchEnv = {
    fetch: async (req) => {
      fetched.push(new URL(req.url).pathname);
      return network(req);
    },
    match: async (r) => cache.get(typeof r === 'string' ? r : new URL(r.url).pathname)?.clone(),
    put: async (req, res) => void cache.set(new URL(req.url).pathname, res),
  };
  return { e, cache, fetched };
}

const get = (path: string, mode: RequestMode = 'cors', init: RequestInit = {}) => {
  const r = new Request(`${ORIGIN}${path}`, init);
  Object.defineProperty(r, 'mode', { value: mode });
  return r;
};

describe('service worker', () => {
  it('never answers or stores board data, sockets, uploads, writes or other sites', async () => {
    const { e, cache, fetched } = env(() => new Response('x'));
    const untouched = [
      get('/api/boards'),
      get('/api/auth/me'),
      get('/ws/board/abc'),
      get('/uploads/abc.png'),
      get('/api', 'navigate'),
      get('/assets/app.js', 'cors', { method: 'POST', body: 'x' }),
      new Request('https://fonts.gstatic.com/s/inter.woff2'),
    ];
    for (const req of untouched) expect(respond(req, ORIGIN, e)).toBeNull();
    expect(fetched).toEqual([]);
    expect(cache.size).toBe(0);
  });

  it('always loads pages from the network (a deploy is picked up at once) and never stores them; offline it shows the offline page', async () => {
    const { e, cache, fetched } = env(() => new Response('<html>new build</html>', { headers: { 'Content-Type': 'text/html' } }));
    cache.set('/offline.html', new Response('offline page'));
    for (const path of ['/app', '/login', '/board/abc']) {
      const res = await respond(get(path, 'navigate'), ORIGIN, e)!;
      expect(await res.text()).toBe('<html>new build</html>');
    }
    expect(fetched).toEqual(['/app', '/login', '/board/abc']);
    expect([...cache.keys()]).toEqual(['/offline.html']);

    const offline = env(() => Promise.reject(new TypeError('Failed to fetch')));
    offline.cache.set('/offline.html', new Response('offline page'));
    expect(await (await respond(get('/board/abc', 'navigate'), ORIGIN, offline.e)!).text()).toBe('offline page');
  });

  it('keeps a build file after its first load, but never a failed or no-store response', async () => {
    let status = 200;
    let headers: Record<string, string> = {};
    const { e, cache, fetched } = env(() => new Response('code', { status, headers }));
    await respond(get('/assets/index-abc123.js'), ORIGIN, e);
    await respond(get('/assets/index-abc123.js'), ORIGIN, e);
    expect(fetched).toEqual(['/assets/index-abc123.js']);

    status = 404;
    await respond(get('/assets/gone-111.js'), ORIGIN, e);
    status = 200;
    headers = { 'Cache-Control': 'no-store' };
    await respond(get('/assets/private-222.js'), ORIGIN, e);
    expect([...cache.keys()]).toEqual(['/assets/index-abc123.js']);
  });
});
