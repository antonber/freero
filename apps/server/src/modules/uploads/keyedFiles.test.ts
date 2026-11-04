// Uploaded files under their workspace's key (#159), through the real upload routes: what is at
// rest, what is served, and when nothing is.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ServerContext } from '../../platform/context';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { initStorage, readAll, storage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { completeSignIn, createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { createKey, forgetAllCachedKeys, resumeKey, rotateKey, suspendKey } from '../keys/index';
import { createTeamWorkspace } from '../workspaces/index';
import { sealPendingFiles } from './keyed';
import { readUpload } from './private';
import uploadRoutes from './routes';
import { CHUNK } from './sealedFiles';
import { saveUpload } from './store';

let server: http.Server;
let base = '';
let dir = '';

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-keyed-files-'));
  const config = await openTestDb({ FREERO_DATA_DIR: dir, PUBLIC_URL: 'http://freero.test', WORKSPACE_KEYS: 'true', MAX_MEDIA_UPLOAD_MB: '3' });
  initStorage(config);
  const app = createApp(config);
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  app.use('/', uploadRoutes({ config, onShutdown: () => undefined } as unknown as ServerContext));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
async function admin() {
  const { id } = await createUser({ name: 'Admin', email: `admin${++n}@keyed-files.test.freero.app`, password: 'password-123' }, { emailVerified: true });
  const res = await fetch(`${base}/test/sign-in/${id}`, { method: 'POST', headers: { origin: base } });
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const ws = (await createTeamWorkspace(id, `Regulated ${n}`)).id;
  const board = await createBoard(id, 'Due diligence', '', 'none', { workspaceId: ws });
  return { id, cookie, ws, board: board.id };
}

const MARKER = 'CONFIDENTIAL-SCAN-OF-PASSPORT-0042';
/** A PNG (by its signature) carrying a recognisable text. */
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${MARKER} `.repeat(40))]);
/** A video several chunks long whose every byte says where it is. */
const video = () => {
  const b = Buffer.alloc(CHUNK * 3 + 1234);
  for (let i = 0; i < b.length; i++) b[i] = (i * 7) & 0xff;
  b.writeUInt32BE(24, 0);
  b.write('ftypisom', 4, 'latin1');
  return b;
};
const at = async (name: string) => readAll((await storage().get(name))!);
const nameOf = (url: string) => url.slice('/uploads/'.length);

async function upload(who: { cookie: string; board: string }, data: Buffer, type: string) {
  const res = await fetch(`${base}/api/uploads?board=${who.board}`, { method: 'POST', headers: { origin: base, cookie: who.cookie, 'content-type': type }, body: new Uint8Array(data) });
  return { status: res.status, url: ((await res.json()) as { url?: string }).url ?? '' };
}

it('a file uploaded to a board of a keyed workspace is ciphertext at rest, and is served opened (byte ranges too) only while the key is usable — suspended, not even a revalidation, a download or an export gets it', async () => {
  const me = await admin();
  await createKey(me.ws, me.id, {});
  const image = png();
  const { status, url } = await upload(me, image, 'image/png');
  expect(status).toBe(201);
  const stored = await at(nameOf(url));
  expect(stored.includes(Buffer.from(MARKER.slice(0, 16)))).toBe(false);
  expect(stored.subarray(0, 8).equals(image.subarray(0, 8))).toBe(false); // not even shown as a PNG if served as is

  const got = await fetch(`${base}${url}`, { redirect: 'manual' });
  expect(got.status).toBe(200);
  expect(Buffer.from(await got.arrayBuffer()).equals(image)).toBe(true);
  expect(got.headers.get('cache-control')).toBe('private, no-cache'); // no shared cache keeps the opened bytes

  const clip = video();
  const media = await upload(me, clip, 'video/mp4');
  const part = await fetch(`${base}${media.url}`, { headers: { range: `bytes=${CHUNK - 10}-${2 * CHUNK + 5}` } });
  expect(part.status).toBe(206);
  expect(part.headers.get('content-range')).toBe(`bytes ${CHUNK - 10}-${2 * CHUNK + 5}/${clip.length}`);
  expect(Buffer.from(await part.arrayBuffer()).equals(clip.subarray(CHUNK - 10, 2 * CHUNK + 6))).toBe(true);

  await suspendKey(me.ws, me.id);
  expect((await fetch(`${base}${url}`)).status).toBe(403);
  expect((await fetch(`${base}${url}`, { headers: { 'if-none-match': `"${nameOf(url)}"` } })).status).toBe(403);
  expect((await fetch(`${base}${media.url}`, { headers: { range: 'bytes=0-99' } })).status).toBe(403);
  expect(await readUpload(url)).toBeNull(); // exports, backups and renders leave it out
  // Nor can anything new be stored for that workspace meanwhile (it couldn't be sealed).
  expect((await upload(me, png(), 'image/png')).status).toBe(403);

  await resumeKey(me.ws, me.id);
  forgetAllCachedKeys(); // another instance
  expect(Buffer.from(await (await fetch(`${base}${url}`)).arrayBuffer()).equals(image)).toBe(true);
});

it("a sealed file's bytes only open as that file: copied under another file's name, or altered by one byte, they are never served", async () => {
  const me = await admin();
  await createKey(me.ws, me.id, {});
  const a = (await upload(me, png(), 'image/png')).url;
  const b = (await upload(me, png(), 'image/png')).url;
  const original = await at(nameOf(b));
  await storage().put(nameOf(b), await at(nameOf(a)), 'image/png');
  expect((await fetch(`${base}${b}`)).status).toBe(403);
  const altered = Buffer.from(original);
  altered[altered.length - 3] ^= 1;
  await storage().put(nameOf(b), altered, 'image/png');
  expect((await fetch(`${base}${b}`)).status).toBe(403);
});

it('files uploaded before the workspace turned its key on are sealed by the background job, and again under the new data key after a rotation, without ever becoming unreadable', async () => {
  const me = await admin();
  const before = png();
  const url = await saveUpload(before, 'image/png', me.id, { workspaceId: me.ws }); // no key yet: as uploaded
  expect((await at(nameOf(url))).includes(Buffer.from(MARKER))).toBe(true);

  await createKey(me.ws, me.id, {});
  await sealPendingFiles();
  expect((await at(nameOf(url))).includes(Buffer.from(MARKER.slice(0, 16)))).toBe(false);
  expect(Buffer.from(await (await fetch(`${base}${url}`)).arrayBuffer()).equals(before)).toBe(true);

  const sealedV1 = await at(nameOf(url));
  await rotateKey(me.ws, me.id, {});
  await sealPendingFiles();
  expect((await at(nameOf(url))).equals(sealedV1)).toBe(false); // sealed again under data key 2
  forgetAllCachedKeys();
  expect(Buffer.from(await (await fetch(`${base}${url}`)).arrayBuffer()).equals(before)).toBe(true);
});
