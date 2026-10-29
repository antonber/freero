#!/usr/bin/env node
// The directory carousel screenshots (Claude connectors directory, ChatGPT app directory): Freero's
// live board view (MCP Apps, apps/server/src/modules/mcp/views/live.html) rendered the way an
// assistant renders it — the view's HTML read from the MCP server, framed by a minimal local host
// that speaks the MCP Apps protocol (ui/initialize, tool-result) and hands it a real open_board
// result. Each PNG is cropped to the view (the app response only, no prompt), ≥ 1000 px wide.
//
//   1. Build the web app (npm run build) and start a throwaway server on spare ports, framing
//      allowed for the local host:
//        PORT=4591 FREERO_DATA_DIR=<scratch>/data PUBLIC_URL=http://127.0.0.1:4591 \
//          MCP_APP_FRAME_ANCESTORS=http://127.0.0.1:4592 node --import tsx apps/server/src/main.ts
//   2. Seed the demo account: FREERO_URL=http://127.0.0.1:4591 REVIEWER_EMAIL=… REVIEWER_PASSWORD=… \
//        node scripts/seed-reviewer-account.mjs
//   3. FREERO_URL=… REVIEWER_EMAIL=… REVIEWER_PASSWORD=… node scripts/directory-shots.mjs [--out dir] [--host-port 4592]
//   4. Look at every image before committing it. Stop the server.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = (opt('url') ?? process.env.FREERO_URL ?? '').replace(/\/+$/, '');
const EMAIL = opt('email') ?? process.env.REVIEWER_EMAIL;
const PASSWORD = opt('password') ?? process.env.REVIEWER_PASSWORD;
const OUT = path.resolve(opt('out', 'docs/marketing/directory-assets'));
const HOST_PORT = Number(opt('host-port', '4592'));
if (!BASE || !EMAIL || !PASSWORD) {
  console.error('Usage: FREERO_URL=… REVIEWER_EMAIL=… REVIEWER_PASSWORD=… node scripts/directory-shots.mjs [--out dir] [--host-port 4592]');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a token for the demo account (revoked at the end) ----
let cookie = '';
async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    cookie = [...cookie.split('; ').filter((x) => x && !x.startsWith(`${pair.split('=')[0]}=`)), pair].join('; ');
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
await api('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
const token = await api('POST', '/api/auth/tokens', { name: 'Directory screenshots', scopes: ['boards:read', 'boards:suggest', 'boards:write', 'comments:write'], expiresInDays: 1 });
const mcp = new Client({ name: 'Claude', version: '1.0.0' });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token.secret}` } } }));

const listed = JSON.parse((await mcp.callTool({ name: 'search_boards', arguments: { limit: 50 } })).content[0].text);
const boards = new Map((listed.untrusted_board_content?.boards ?? []).map((b) => [b.title, b.id]));
const boardId = (title) => {
  const id = boards.get(title);
  if (!id) throw new Error(`No board "${title}" on this account: run scripts/seed-reviewer-account.mjs first`);
  return id;
};
const [liveView] = (await mcp.readResource({ uri: 'ui://freero/board-live.html' })).contents;

// ---- the local host: a page that frames the view and answers its MCP Apps requests ----
const HOST_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>MCP Apps host</title>
<style>html,body{margin:0;background:#ffffff}#frame{display:block;border:0;width:100%}</style></head>
<body><iframe id="frame" src="/view.html" title="Freero"></iframe><script>
const frame = document.getElementById('frame');
if (window.MODE === 'fullscreen') frame.style.height = '100vh';
let toolResult = null, ready = false;
window.setToolResult = (r) => { toolResult = r; if (ready) send(); };
const send = () => frame.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: toolResult }, '*');
window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow) return;
  const m = e.data || {};
  if (m.method === 'ui/initialize') frame.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'local-host', version: '1' }, hostCapabilities: { openLinks: {} }, hostContext: { theme: window.THEME || 'light', displayMode: window.MODE || 'inline', availableDisplayModes: ['inline', 'fullscreen'] } } }, '*');
  else if (m.method === 'ui/notifications/initialized') { ready = true; if (toolResult) send(); }
  // Inline, the frame takes the height the view reports; full screen, the window's.
  else if (m.method === 'ui/notifications/size-changed') { if (window.MODE !== 'fullscreen') frame.style.height = m.params.height + 'px'; }
  else if (m.id !== undefined && m.method) frame.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: {} }, '*');
});
</script></body></html>`;
const host = http.createServer((req, res) => {
  if (req.url === '/view.html') {
    // The CSP a host builds from the resource's _meta.ui.csp: framing Freero's origin, nothing else.
    const csp = liveView._meta?.ui?.csp ?? {};
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src ${(csp.frameDomains ?? []).join(' ')}` });
    return res.end(liveView.text);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(HOST_HTML);
});
await new Promise((r) => host.listen(HOST_PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const shots = [];
// The host's full-screen display mode (the view's own "Full screen"), at 1600 × 1000: the board is
// readable, and the PNG is the view alone.
async function shoot(name, title, { width = 1600, theme = 'light', mode = 'fullscreen', height = 1000, settle = 2500, prompt }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme });
  await page.addInitScript(([t, m]) => Object.assign(window, { THEME: t, MODE: m }), [theme, mode]);
  await page.goto(`http://127.0.0.1:${HOST_PORT}/`);
  const result = await mcp.callTool({ name: 'open_board', arguments: { boardId: boardId(title) } });
  await page.evaluate((r) => window.setToolResult(r), result);
  // The board page inside the view: wait until it has drawn the board, then let it settle.
  const board = page.frameLocator('#frame').frameLocator('iframe');
  await board.locator('.fr-board [data-id]').first().waitFor({ timeout: 30_000 });
  await sleep(800);
  // What a person does first in a small frame: fit the board to the view.
  await board.getByRole('button', { name: 'Fit to screen' }).click();
  await sleep(settle);
  const file = path.join(OUT, `${name}.png`);
  await page.locator('#frame').screenshot({ path: file });
  await page.close();
  shots.push({ file: path.relative(process.cwd(), file).replace(/\\/g, '/'), board: title, prompt });
  console.log(`saved ${file}`);
}

try {
  await shoot('01-retro-themes', 'Sprint 14 retro', { prompt: 'Group the notes on my Sprint 14 retro board into themes and add action items, then show me the board.' });
  await shoot('02-roadmap-kanban', 'Product roadmap: H1 2027', { prompt: 'Turn our H1 planning notes into a Now / Next / Later roadmap with owners and dates on a Freero board.' });
  await shoot('03-control-room', 'Agent control room: docs migration', {
    prompt: 'Migrate our help-center articles and keep me posted in a Freero control room so I can steer you.',
  });
  await shoot('04-signup-flow', 'Signup flow', { prompt: 'Draw our signup flow as a diagram on a Freero board and list the open questions next to it.' });
  fs.writeFileSync(path.join(OUT, 'carousel.json'), `${JSON.stringify(shots, null, 2)}\n`);
} finally {
  await browser.close();
  host.close();
  await mcp.close().catch(() => undefined);
  await api('DELETE', `/api/auth/tokens/${encodeURIComponent(token.token?.id ?? token.id)}`).catch(() => undefined);
}
