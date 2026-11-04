// Data export archives (#4): what a team's assets carry into the workspace export, built on real
// workspaces, uploads and packs (in-memory Postgres, local storage).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { initStorage } from '../../platform/storage';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { createPack } from '../shapepacks/index';
import { addSticker, createSet } from '../stickers/index';
import { saveUpload } from '../uploads/index';
import { createTeamWorkspace, inviteToWorkspace } from '../workspaces/index';
import { buildWorkspaceArchive } from './archive';

let dir = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-archive-'));
  initStorage(await openTestDb({ FREERO_DATA_DIR: dir }));
});
afterAll(async () => {
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
const person = (name: string) => createUser({ name, email: `${name.toLowerCase()}${++n}@archive.test.freero.app`, password: 'password-123' }, { emailVerified: true });
const svgZip = (userId: string, name: string) =>
  saveUpload(zipSync({ [`${name}.svg`]: strToU8('<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>') }), 'application/zip', userId, { attachment: true });
const png = () => {
  const b = Buffer.alloc(64, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  return b;
};

it('a workspace export carries the team’s shape packs and sticker sets with each sticker’s image, but never a member’s own library', async () => {
  const [owner, member] = await Promise.all([person('Owner'), person('Member')]);
  const ws = await createTeamWorkspace(owner.id, 'Design ops');
  await inviteToWorkspace(null, ws.id, owner, { email: member.email, role: 'member' });
  const board = await createBoard(owner.id, 'Systems', '', 'none', { workspaceId: ws.id });
  await createPack(board.id, owner.id, { name: 'Brand icons', upload: await svgZip(owner.id, 'logo') });
  await createPack(board.id, member.id, { name: 'Private doodles', upload: await svgZip(member.id, 'doodle'), personal: true });
  const set = await createSet(board.id, member.id, { name: 'Team faces' });
  const sticker = await addSticker(set.id, member.id, png(), 'image/png', 'Thumbs up');

  const files = unzipSync(await buildWorkspaceArchive(ws.id, 'https://freero.test'));
  const packs = Object.keys(files).filter((f) => f.startsWith('shape-packs/'));
  expect(packs).toHaveLength(1);
  expect(JSON.parse(strFromU8(files[packs[0]]))).toMatchObject({ name: 'Brand icons', icons: [{ name: 'logo', nodes: [['path', { d: 'M2 2h20v20H2z' }]] }] });
  expect(Object.keys(files).join('\n')).not.toContain('doodle');

  const stickers = JSON.parse(strFromU8(files['stickers/index.json'])) as Array<{ name: string; stickers: Array<{ name: string; uploadName: string }> }>;
  expect(stickers).toMatchObject([{ name: 'Team faces', stickers: [{ name: 'Thumbs up' }] }]);
  const image = stickers[0].stickers[0].uploadName;
  expect(sticker.url).toBe(`/uploads/${image}`);
  expect(Buffer.from(files[`stickers/${image}`])).toEqual(png());
});
