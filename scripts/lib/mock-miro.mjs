// Test-only Miro: the subset of Miro's REST API v2 that "Import from Miro" (#62) reads, in memory,
// for the server tests and for trying the import dialog by hand. Never the real Miro. Point Freero
// at it with MIRO_API_URL=<url>. Any token in MOCK_MIRO_TOKENS is accepted (default: one token,
// printed at start).
//
//   GET /v2/boards/:id                                    the board's name
//   GET /v2/boards/:id/items?limit=&cursor=               items, cursor-paged (10..50 a page)
//   GET /v2/boards/:id/connectors?limit=&cursor=          connectors, cursor-paged
//   GET /v2/boards/:id/tags?limit=&offset=                tags, offset-paged
//   GET /v2/boards/:id/resources/images/:res?redirect=false  { type: 'image', url } (a "signed" link)
//   GET /cdn/:res.png                                     the picture itself (no token needed, like a signed link)
//
// Tests steer it: `requests` (method, path, whether a token was sent), `hugeBoard(n)` (a board of n
// stickies), `rateLimited = true` (every API call answers 429).
//
//   node scripts/lib/mock-miro.mjs --port 4472

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { solidPng } from './mock-figma.mjs';

export const MOCK_MIRO_BOARD = 'uXjVMockBoard=';
export const MOCK_MIRO_TOKEN = 'mock-miro-token-5f1c0e2a9b7d';
export const HOSTILE = '<img src=x onerror="alert(1)"><script>alert(2)</script>Ship it &amp; tell <b>everyone</b>';

const at = (x, y) => ({ x, y, origin: 'center', relativeTo: 'canvas_center' });
const inFrame = (x, y) => ({ x, y, origin: 'center', relativeTo: 'parent_top_left' });
const geo = (width, height, rotation = 0) => ({ width, height, rotation });

/** The board a migrating team would bring: a frame holding stickies, shapes joined by connectors, text, a picture, cards, things Freero can't map. */
function sampleBoard(base) {
  const frame = { id: '3458764500000000001', type: 'frame', data: { title: 'Sprint 12 retro', format: 'custom', type: 'freeform' }, style: { fillColor: '#ffffffff' }, position: at(0, 0), geometry: geo(1200, 800) };
  const parent = { parent: { id: frame.id } };
  return {
    name: 'Team retro (from Miro)',
    items: [
      frame,
      { id: '3458764500000000002', type: 'sticky_note', data: { content: '<p>Went well: <strong>pairing</strong></p>', shape: 'square' }, style: { fillColor: 'light_yellow', textAlign: 'center' }, position: inFrame(200, 200), geometry: geo(199, 228), tagIds: ['3458764500000009001'], ...parent },
      { id: '3458764500000000003', type: 'sticky_note', data: { content: HOSTILE, shape: 'rectangle' }, style: { fillColor: 'light_pink' }, position: inFrame(500, 200), geometry: geo(350, 228), ...parent },
      { id: '3458764500000000004', type: 'shape', data: { content: '<p>Plan</p>', shape: 'round_rectangle' }, style: { fillColor: '#ffd02f', borderColor: '#1a1a1a', borderWidth: '2', borderStyle: 'normal', fontSize: '24', color: '#1a1a1a', textAlign: 'center' }, position: at(900, -300), geometry: geo(240, 120) },
      { id: '3458764500000000005', type: 'shape', data: { content: '<p>Ship?</p>', shape: 'rhombus' }, style: { fillColor: '#ffffff', borderColor: '#1a1a1a' }, position: at(900, 0), geometry: geo(200, 160) },
      { id: '3458764500000000006', type: 'shape', data: { content: '', shape: 'wedge_round_rectangle_callout' }, style: { fillColor: '#ffffff' }, position: at(900, 300), geometry: geo(200, 120) },
      { id: '3458764500000000007', type: 'text', data: { content: '<p>Retro notes</p>' }, style: { fontSize: '36', color: '#1a1a1a', textAlign: 'left' }, position: at(0, -500), geometry: { width: 400 } },
      { id: '3458764500000000008', type: 'image', data: { title: 'Whiteboard photo', imageUrl: `${base}/v2/boards/${encodeURIComponent(MOCK_MIRO_BOARD)}/resources/images/9001?format=preview&redirect=false` }, position: at(-900, 0), geometry: geo(320, 240) },
      { id: '3458764500000000009', type: 'card', data: { title: 'Follow up with design', description: '<p>Bring the <em>new</em> flows</p>', dueDate: '2026-11-20T00:00:00Z' }, style: { cardTheme: '#2d9bf0' }, position: at(-900, 400), geometry: geo(320, 94), tagIds: ['3458764500000009002'] },
      { id: '3458764500000000010', type: 'app_card', data: { title: 'JIRA-12 Checkout bug', description: '', status: 'connected' }, style: { fillColor: '#2d9bf0' }, position: at(-900, 600), geometry: geo(320, 94) },
      { id: '3458764500000000011', type: 'embed', data: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', mode: 'inline' }, position: at(-400, 600), geometry: geo(480, 270) },
      { id: '3458764500000000012', type: 'document', data: { title: 'Brief.pdf', documentUrl: `${base}/v2/boards/x/resources/documents/1` }, position: at(-400, 900), geometry: geo(200, 280) },
      { id: '3458764500000000013', type: 'mindmap_node', data: { nodeView: { data: { content: 'Idea' } } }, position: at(0, 900), geometry: geo(100, 40) },
    ],
    connectors: [
      { id: '3458764500000005001', startItem: { id: '3458764500000000004', position: { x: '50%', y: '100%' } }, endItem: { id: '3458764500000000005', position: { x: '50%', y: '0%' } }, shape: 'elbowed', captions: [{ content: '<p>then</p>' }], style: { strokeColor: '#1a1a1a', strokeWidth: '2', strokeStyle: 'dashed', startStrokeCap: 'none', endStrokeCap: 'stealth' } },
      { id: '3458764500000005002', startItem: { id: '3458764500000000005' }, endItem: { id: '3458764500000000006' }, shape: 'straight', style: { endStrokeCap: 'filled_triangle' } },
      { id: '3458764500000005003', startItem: { id: '3458764500000000002' }, endItem: { id: '3458764500000000003' }, shape: 'curved', style: {} },
    ],
    tags: [
      { id: '3458764500000009001', title: 'Keep', fillColor: 'green' },
      { id: '3458764500000009002', title: 'Action <script>', fillColor: 'red' },
    ],
  };
}

export async function startMockMiro({ port = 0, host = '127.0.0.1', tokens = [MOCK_MIRO_TOKEN] } = {}) {
  const state = { url: '', rateLimited: false };
  const requests = [];
  const boards = new Map();
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const page = (list, u) => {
    const limit = Math.max(10, Math.min(50, Number(u.searchParams.get('limit')) || 10));
    const from = Number(u.searchParams.get('cursor') || 0) || 0;
    const data = list.slice(from, from + limit);
    const next = from + limit < list.length ? String(from + limit) : undefined;
    return { data, total: list.length, size: data.length, limit, ...(next ? { cursor: next } : {}), links: {} };
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    requests.push({ method: req.method, path: u.pathname, authorized: !!req.headers.authorization });
    if (req.method === 'GET' && u.pathname.startsWith('/cdn/')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(solidPng(32, 24, [240, 180, 40]));
    }
    if (state.rateLimited) return json(res, 429, { status: 429, code: 'tooManyRequests', message: 'Request rate limit exceeded.', type: 'error' });
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!tokens.includes(token)) return json(res, 401, { status: 401, code: 'tokenNotProvided', message: 'Authorization failed', type: 'error' });
    const m = /^\/v2\/boards\/([^/]+)(?:\/(items|connectors|tags|resources\/images\/([^/]+)))?$/.exec(u.pathname);
    const id = m ? decodeURIComponent(m[1]) : null;
    if (id === MOCK_MIRO_BOARD && !boards.has(id)) boards.set(id, sampleBoard(state.url));
    const board = id ? boards.get(id) : null;
    if (!board) return json(res, 404, { status: 404, code: 'boardNotFound', message: 'Board not found', type: 'error' });
    if (!m[2]) return json(res, 200, { id, type: 'board', name: board.name, description: '' });
    if (m[2] === 'items') return json(res, 200, page(board.items, u));
    if (m[2] === 'connectors') return json(res, 200, page(board.connectors, u));
    if (m[2] === 'tags') {
      const limit = Math.max(1, Math.min(50, Number(u.searchParams.get('limit')) || 20));
      const offset = Number(u.searchParams.get('offset') || 0) || 0;
      const data = board.tags.slice(offset, offset + limit);
      return json(res, 200, { data, total: board.tags.length, size: data.length, offset, limit, type: 'list' });
    }
    // An image resource: with redirect=false, where the picture can be downloaded.
    return json(res, 200, { type: 'image', url: `${state.url}/cdn/${encodeURIComponent(m[3])}.png?signature=abc` });
  });
  await new Promise((r) => server.listen(port, host, r));
  state.url = `http://${host}:${server.address().port}`;
  return {
    get url() {
      return state.url;
    },
    requests,
    set rateLimited(v) {
      state.rateLimited = v;
    },
    /** A board of `n` stickies (and n connectors between them), at a new id. */
    hugeBoard(n) {
      const id = `uXjVHuge${n}=`;
      const items = Array.from({ length: n }, (_, i) => ({ id: `9${String(i).padStart(12, '0')}`, type: 'sticky_note', data: { content: `Note ${i}`, shape: 'square' }, style: { fillColor: 'yellow' }, position: at((i % 100) * 250, Math.floor(i / 100) * 250), geometry: geo(199, 228) }));
      const connectors = items.slice(1).map((it, i) => ({ id: `8${String(i).padStart(12, '0')}`, startItem: { id: items[i].id }, endItem: { id: it.id }, shape: 'straight', style: {} }));
      boards.set(id, { name: `Huge board ${n}`, items, connectors, tags: [] });
      return id;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--port');
  const miro = await startMockMiro({ port: i > 0 ? Number(process.argv[i + 1]) : 4472 });
  console.log(`mock Miro at ${miro.url} — board https://miro.com/app/board/${MOCK_MIRO_BOARD}/ — token ${MOCK_MIRO_TOKEN}`);
}
