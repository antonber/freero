// Test-only Figma: the subset of Figma's REST API and OAuth that "Place from Figma" (#171) uses, in
// memory, for the server tests and trying the picker by hand. Never the real Figma. Point Freero at
// it with FIGMA_API_URL=<url> and FIGMA_OAUTH_URL=<url>/oauth (any FIGMA_CLIENT_ID / _SECRET).
//
//   GET  /oauth                      Figma's consent page: approves at once, back to redirect_uri
//   POST /v1/oauth/token, /refresh   tokens (HTTP Basic client credentials, as Figma takes them)
//   GET  /v1/me, /v1/files/:key?depth=2, /v1/files/:key/nodes?ids=, /v1/images/:key?ids=&scale=
//   GET  /render/:key/:node.png      the "rendered" PNGs /v1/images links to (a solid colour)
//
// Tests steer it: `revokeAll()` (Figma refuses every token, refreshes too), `expireAccess()` (the
// access tokens stop working, refreshing still works), `renders = 'html'` (renders come back as
// an HTML page instead of a PNG), `renderBytes = n` (renders that big).
//
//   node scripts/lib/mock-figma.mjs --port 4471

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** A w×h PNG of one colour ([r, g, b]). */
export function solidPng(w, h, [r, g, b] = [91, 63, 240]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const MOCK_FILE_KEY = 'MockCheckoutFile2026';

export async function startMockFigma({ port = 0, host = '127.0.0.1' } = {}) {
  const files = new Map([
    [
      MOCK_FILE_KEY,
      {
        name: 'Checkout redesign',
        pages: [
          {
            name: 'Flows',
            nodes: [
              { id: '1:2', name: 'Cart', type: 'FRAME', w: 390, h: 844, colour: [91, 63, 240] },
              { id: '1:3', name: 'Payment', type: 'FRAME', w: 390, h: 844, colour: [255, 176, 32] },
              { id: '1:4', name: 'Sticky note', type: 'STICKY', w: 200, h: 200 },
            ],
          },
          { name: 'Components', nodes: [{ id: '2:1', name: 'Button', type: 'COMPONENT_SET', w: 320, h: 120, colour: [22, 163, 74] }] },
        ],
      },
    ],
  ]);
  const codes = new Map();
  const access = new Map(); // token -> user
  const refresh = new Set();
  const requests = [];
  const state = { renders: 'png', renderBytes: 0, url: '' };

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      const parts = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    });
  const issue = () => {
    const a = `figu_${randomBytes(12).toString('hex')}`;
    const r = `figr_${randomBytes(12).toString('hex')}`;
    access.set(a, '1001');
    refresh.add(r);
    return { access_token: a, refresh_token: r, expires_in: 7_776_000, token_type: 'bearer', user_id_string: '1001' };
  };
  const nodeOf = (key, id) => files.get(key)?.pages.flatMap((p) => p.nodes).find((n) => n.id === id);

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    requests.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams) });
    if (req.method === 'GET' && u.pathname === '/oauth') {
      const code = randomBytes(10).toString('hex');
      codes.set(code, u.searchParams.get('redirect_uri'));
      const back = new URL(u.searchParams.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', u.searchParams.get('state') ?? '');
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (req.method === 'POST' && (u.pathname === '/v1/oauth/token' || u.pathname === '/v1/oauth/refresh')) {
      if (!/^Basic /.test(req.headers.authorization ?? '')) return json(res, 401, { error: 'invalid_client' });
      const form = new URLSearchParams(await readBody(req));
      if (u.pathname.endsWith('/token')) {
        const redirect = codes.get(form.get('code'));
        codes.delete(form.get('code'));
        if (!redirect || redirect !== form.get('redirect_uri')) return json(res, 400, { error: 'invalid_grant' });
        return json(res, 200, issue());
      }
      if (!refresh.has(form.get('refresh_token'))) return json(res, 400, { error: 'invalid_grant' });
      const t = issue();
      return json(res, 200, { access_token: t.access_token, expires_in: t.expires_in, token_type: 'bearer' });
    }
    if (req.method === 'GET' && u.pathname.startsWith('/render/')) {
      const [, , key, file] = u.pathname.split('/');
      const n = nodeOf(key, decodeURIComponent(file.replace(/\.png$/, '')));
      if (!n) return json(res, 404, { err: 'Not found' });
      if (state.renders === 'html') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end('<!doctype html><script>alert(1)</script>');
      }
      const scale = Number(u.searchParams.get('scale')) || 1;
      let png = solidPng(Math.max(1, Math.round(n.w * scale)), Math.max(1, Math.round(n.h * scale)), n.colour);
      if (state.renderBytes > png.length) png = Buffer.concat([png, Buffer.alloc(state.renderBytes - png.length)]);
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(png);
    }
    // Everything below needs a token.
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!access.has(token)) return json(res, 401, { status: 401, err: 'Invalid token' });
    if (req.method === 'GET' && u.pathname === '/v1/me') return json(res, 200, { id: '1001', handle: 'Ada Designer', email: 'ada@example.com', img_url: '' });
    const m = /^\/v1\/(files|images)\/([^/]+)(\/nodes)?$/.exec(u.pathname);
    const file = m ? files.get(decodeURIComponent(m[2])) : null;
    if (m && !file) return json(res, 404, { status: 404, err: 'Not found' });
    if (m && m[1] === 'files' && !m[3]) {
      return json(res, 200, {
        name: file.name,
        thumbnailUrl: `https://s3-alpha.figma.example/thumbnails/${m[2]}.png`,
        document: {
          id: '0:0',
          type: 'DOCUMENT',
          children: file.pages.map((p, i) => ({
            id: `0:${i + 1}`,
            name: p.name,
            type: 'CANVAS',
            children: p.nodes.map((n) => ({ id: n.id, name: n.name, type: n.type, absoluteBoundingBox: { x: 0, y: 0, width: n.w, height: n.h } })),
          })),
        },
      });
    }
    if (m && m[3]) {
      const nodes = {};
      for (const id of (u.searchParams.get('ids') ?? '').split(',')) {
        const n = nodeOf(m[2], id);
        nodes[id] = n ? { document: { id, name: n.name, type: n.type, absoluteBoundingBox: { x: 0, y: 0, width: n.w, height: n.h } } } : null;
      }
      return json(res, 200, { name: file.name, nodes });
    }
    if (m && m[1] === 'images') {
      const images = {};
      for (const id of (u.searchParams.get('ids') ?? '').split(','))
        images[id] = nodeOf(m[2], id) ? `${state.url}/render/${m[2]}/${encodeURIComponent(id)}.png?scale=${u.searchParams.get('scale') ?? '1'}` : null;
      return json(res, 200, { err: null, images });
    }
    json(res, 404, { err: 'Not found' });
  });
  await new Promise((r) => server.listen(port, host, r));
  state.url = `http://${host}:${server.address().port}`;
  return {
    get url() {
      return state.url;
    },
    requests,
    set renders(v) {
      state.renders = v;
    },
    set renderBytes(v) {
      state.renderBytes = v;
    },
    revokeAll() {
      access.clear();
      refresh.clear();
    },
    expireAccess() {
      access.clear();
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--port');
  const figma = await startMockFigma({ port: i > 0 ? Number(process.argv[i + 1]) : 4471 });
  console.log(`mock Figma at ${figma.url} (file ${MOCK_FILE_KEY})`);
}
