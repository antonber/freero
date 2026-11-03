import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MAX_STICKER_BYTES } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { initStorage } from '../../platform/storage';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { uploadBytesUsed } from '../uploads/index';
import { inviteBoardMember } from '../members/index';
import { createTeamWorkspace, inviteToWorkspace } from '../workspaces/index';
import { addSticker, createSet, listStickers, removeSet, removeSticker } from './service';

let dir = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-stickers-'));
  initStorage(await openTestDb({ FREERO_DATA_DIR: dir }));
});
afterAll(async () => {
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
const person = (name: string) =>
  createUser({ name, email: `${name.toLowerCase()}${++n}@test.freero.app`, password: 'password-123' }, { emailVerified: true });

const png = (bytes = 64) => {
  const b = Buffer.alloc(bytes, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  return b;
};

async function team() {
  const [owner, member, admin, guest] = await Promise.all(['Owner', 'Member', 'Admin', 'Guest'].map(person));
  const ws = await createTeamWorkspace(owner.id, 'Workshop crew');
  await inviteToWorkspace(null, ws.id, owner, { email: member.email, role: 'member' });
  await inviteToWorkspace(null, ws.id, owner, { email: admin.email, role: 'admin' });
  await inviteToWorkspace(null, ws.id, owner, { email: guest.email, role: 'guest' });
  const board = await createBoard(owner.id, 'Retro', '', 'none', { workspaceId: ws.id });
  await inviteBoardMember(null, board.id, owner, { email: guest.email, role: 'editor' });
  return { owner, member, admin, guest, board };
}

it('a sticker image goes through the upload checks: a fake SVG, a PDF and an oversized image are refused and use no quota', async () => {
  const { member, board } = await team();
  const set = await createSet(board.id, member.id, { name: 'Team faces' });
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  await expect(addSticker(set.id, member.id, html, 'image/svg+xml', 'Sneaky')).rejects.toMatchObject({ status: 400 });
  await expect(addSticker(set.id, member.id, Buffer.from('%PDF-1.7\n'), 'application/pdf', 'Doc')).rejects.toMatchObject({ status: 415 });
  await expect(addSticker(set.id, member.id, png(MAX_STICKER_BYTES + 1), 'image/png', 'Huge')).rejects.toMatchObject({ status: 413 });
  expect(await uploadBytesUsed(member.id)).toBe(0);
  expect((await listStickers(board.id, member.id)).sets[0].stickers).toEqual([]);

  // A real image lands in the set, counted against its uploader's quota.
  const ok = await addSticker(set.id, member.id, png(), 'image/png', '  High five ');
  expect(ok).toMatchObject({ name: 'High five', url: expect.stringMatching(/^\/uploads\/[A-Za-z0-9_-]+\.png$/) });
  expect(await uploadBytesUsed(member.id)).toBe(64);
});

it('the workspace shares its sets: guests place but cannot add, outsiders on the board see none, and only the creator or an admin removes a set', async () => {
  const { owner, member, admin, guest, board } = await team();
  const set = await createSet(board.id, member.id, { name: 'Wins' });
  const sticker = await addSticker(set.id, member.id, png(), 'image/png', 'Trophy');

  const guestView = await listStickers(board.id, guest.id);
  expect(guestView).toMatchObject({ canCreate: false, sets: [{ id: set.id, canAdd: false, canManage: false, stickers: [sticker] }] });
  await expect(addSticker(set.id, guest.id, png(), 'image/png', 'Mine')).rejects.toMatchObject({ status: 403 });
  await expect(createSet(board.id, guest.id, { name: 'Guest set' })).rejects.toMatchObject({ status: 403 });

  // Someone on the board but outside the workspace sees no team sets, and can't reach one.
  const outsider = await person('Outsider');
  await inviteBoardMember(null, board.id, owner, { email: outsider.email, role: 'editor' });
  expect(await listStickers(board.id, outsider.id)).toEqual({ sets: [], canCreate: false });
  await expect(removeSet(set.id, outsider.id)).rejects.toMatchObject({ status: 404 });

  // A guest can't remove it; the workspace admin can (they didn't make it).
  await expect(removeSticker(set.id, sticker.id, guest.id)).rejects.toMatchObject({ status: 403 });
  await removeSet(set.id, admin.id);
  expect((await listStickers(board.id, member.id)).sets).toEqual([]);
});
