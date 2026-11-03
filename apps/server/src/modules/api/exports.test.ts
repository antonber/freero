// Board pictures drawn on the server (#33) over real HTTP (in-memory Postgres): an export like the
// app's — the board's "viewers and commenters can copy and export" and the scope decide, at the
// moment of the download too — and a picture whose board text can't become markup.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DOWNLOADS_RESTRICTED, type ApiScope } from '@freero/shared';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { initStorage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createPersonalToken } from '../apiauth/index';
import { createUser, getAccount } from '../auth/index';
import { createBoard, setBoardSharingSettings } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import apiRoutes, { mountPath } from './routes';

let server: http.Server;
let origin = '';

beforeAll(async () => {
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test' });
  initStorage(config);
  const app = createApp(config);
  app.use(mountPath, apiRoutes({ config, onShutdown: () => undefined }));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDb();
});

let n = 0;
const person = (label: string) => createUser({ name: label, email: `${label.toLowerCase()}-${++n}@exports.test.freero.app`, password: 'password-123' }, { emailVerified: true });
const tokenOf = async (userId: string, scopes: ApiScope[]) => (await createPersonalToken(userId, 'password', { name: scopes.join(' '), scopes, expiresInDays: 1 })).secret;
const v1 = (token: string, method: string, path: string, body?: unknown) =>
  fetch(`${origin}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
/** The download link a URL names, on this test server. */
const local = (url: string) => url.replace('http://freero.test', origin);

it('a viewer’s picture export is refused once the board keeps viewers from exporting — also through a download link they got before — while the owner’s goes on; a link works once', async () => {
  const [owner, viewer] = [await person('Owner'), await person('Viewer')];
  const board = await createBoard(owner.id, 'Pricing', '', 'none');
  await inviteBoardMember(null, board.id, await getAccount(owner.id), { email: viewer.email, role: 'viewer' });
  const [own, view] = [await tokenOf(owner.id, ['boards:read', 'boards:write']), await tokenOf(viewer.id, ['boards:read'])];
  await v1(own, 'POST', `/boards/${board.id}/items`, { items: [{ type: 'sticky', text: 'Price: 9 €' }, { type: 'shape', shape: 'ellipse', text: 'Plan' }] });

  const png = await v1(view, 'POST', `/boards/${board.id}/export`, { format: 'png' });
  expect(png.status).toBe(200);
  expect([...new Uint8Array(await png.arrayBuffer()).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  const early = (await (await v1(view, 'POST', `/boards/${board.id}/export`, { format: 'pdf', link: true })).json()) as { url: string };

  // The owner turns "Viewers and commenters can copy and export" off (the share dialog's setting).
  await setBoardSharingSettings(board.id, owner.id, { viewersCanExport: false });

  for (const res of [await v1(view, 'POST', `/boards/${board.id}/export`, { format: 'png' }), await v1(view, 'POST', `/boards/${board.id}/export`, { format: 'svg', link: true }), await fetch(local(early.url))]) {
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(DOWNLOADS_RESTRICTED);
  }
  const link = (await (await v1(own, 'POST', `/boards/${board.id}/export`, { format: 'pdf', link: true })).json()) as { url: string };
  const pdf = await fetch(local(link.url));
  expect(pdf.status).toBe(200);
  expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  expect((await fetch(local(link.url))).status).toBe(404);
  // Without boards:read nothing is drawn.
  expect((await v1(await tokenOf(owner.id, ['comments:write']), 'POST', `/boards/${board.id}/export`, { format: 'png' })).status).toBe(403);
});

it('board text in an SVG export stays text: a note that “closes” its element and adds a script or an external image is escaped', async () => {
  const owner = await person('Writer');
  const board = await createBoard(owner.id, 'Notes', '', 'none');
  const own = await tokenOf(owner.id, ['boards:read', 'boards:write']);
  const attack = '</tspan></text><script>alert(1)</script><image href="https://evil.example/x.png"/>';
  await v1(own, 'POST', `/boards/${board.id}/items`, { items: [{ type: 'sticky', text: attack }, { type: 'frame', title: attack, w: 400, h: 300 }] });
  const res = await v1(own, 'POST', `/boards/${board.id}/export`, { format: 'svg' });
  expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
  const svg = await res.text();
  expect(svg).not.toMatch(/<script|evil\.example\/x\.png"\/>/);
  expect(svg).toContain('&lt;script&gt;');
});
