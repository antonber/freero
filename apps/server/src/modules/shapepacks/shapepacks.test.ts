// Shape packs (#4) on real workspaces and uploads (in-memory Postgres, local storage), through the
// service the routes use.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { initStorage } from '../../platform/storage';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { readUpload, saveUpload } from '../uploads/index';
import { createTeamWorkspace, inviteToWorkspace } from '../workspaces/index';
import { createPack, listPacks, removePack, renamePack } from './service';

let dir = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-shapepacks-'));
  initStorage(await openTestDb({ FREERO_DATA_DIR: dir }));
});
afterAll(async () => {
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
const person = (name: string) =>
  createUser({ name, email: `${name.toLowerCase()}${++n}@shapepacks.test.freero.app`, password: 'password-123' }, { emailVerified: true });

async function team() {
  const [owner, member, guest] = await Promise.all(['Owner', 'Member', 'Guest'].map(person));
  const ws = await createTeamWorkspace(owner.id, `Platform ${++n}`);
  await inviteToWorkspace(null, ws.id, owner, { email: member.email, role: 'member' });
  await inviteToWorkspace(null, ws.id, owner, { email: guest.email, role: 'guest' });
  const board = await createBoard(owner.id, 'Architecture', '', 'none', { workspaceId: ws.id });
  await inviteBoardMember(null, board.id, owner, { email: guest.email, role: 'editor' });
  return { owner, member, guest, board };
}

/** A ZIP of `files`, uploaded by `userId` as an attachment (as the app does). */
const uploadZip = (userId: string, files: Record<string, string>) =>
  saveUpload(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))), 'application/zip', userId, { attachment: true });

// Everything a hostile SVG tries, in one file: entities, handlers, scripts, foreign HTML, links,
// external references (href, xlink:href, CSS url()), <use>, <image>, styles and javascript: URLs.
const HOSTILE = `<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY boom "<script>alert('entity')</script>">]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64" onload="alert('onload')">
  <script type="text/javascript">alert('script')</script>
  <style>@import url(https://evil.test/x.css); .shape { fill: #ff9900 } path { fill: url(https://evil.test/paint) }</style>
  <foreignObject width="64" height="64"><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert('img')"/></div></foreignObject>
  <a href="javascript:alert('link')"><rect class="shape" x="4" y="4" width="56" height="56" onclick="alert('click')"/></a>
  <path d="M8 8 L56 56" stroke="#232f3e" style="stroke-width: 4; filter: url(https://evil.test/f)" onmouseover="alert('hover')"/>
  <circle cx="32" cy="32" r="8" fill="url(https://evil.test/paint)"/>
  <image href="https://tracker.test/pixel.png" xlink:href="https://tracker.test/pixel.png" width="64" height="64"/>
  <use href="https://evil.test/sprite.svg#icon"/>
  <path d="M0 0&quot;/&gt;&lt;script&gt;alert('attr')&lt;/script&gt;" fill="&boom;"/>
  <animate attributeName="href" to="javascript:alert('animate')"/>
</svg>`;

/** Anything that could run, link or load: none of it may survive anywhere the drawing goes. */
const ACTIVE = /script|alert|on[a-z]+=|href|url\(|foreignObject|<use|<image|<a[\s>]|<style|javascript:|evil\.test|tracker\.test|@import|<animate/i;

it('a hostile SVG in an uploaded pack keeps only its drawing — nothing of it that could run, link or load — and the uploaded file itself is gone', async () => {
  const { owner, board } = await team();
  const upload = await uploadZip(owner.id, { 'aws/Arch_Amazon-EC2_64.svg': HOSTILE, 'README.txt': 'not an icon', 'broken.svg': '<svg><script>alert(1)</script></svg>' });

  const { pack, skipped } = await createPack(board.id, owner.id, { name: 'AWS', upload });

  // The broken file draws nothing and is reported; the README isn't an SVG at all.
  expect(skipped).toEqual(['broken.svg']);
  expect(pack.icons).toHaveLength(1);
  const icon = pack.icons[0];
  expect(icon).toMatchObject({ name: 'Arch_Amazon-EC2_64', viewBox: '0 0 64 64', art: 'color' });
  // The shapes are kept, in their own colours (the class rule's orange; the external paint isn't one).
  expect(icon.nodes.map(([tag]) => tag)).toEqual(['rect', 'path', 'circle']);
  expect(icon.nodes[0][1]).toMatchObject({ fill: '#ff9900' });
  expect(icon.nodes[1][1]).toMatchObject({ stroke: '#232f3e', 'stroke-width': '4' });
  expect(JSON.stringify(icon.nodes)).not.toMatch(ACTIVE);

  // The uploaded file was read once and deleted: the hostile SVG is served from nowhere.
  expect(await readUpload(upload)).toBeNull();
});

it('a workspace’s packs show to its members and guests only — not to someone on the board through a board invite — and only its owners and admins add or remove them', async () => {
  const { owner, member, guest, board } = await team();
  const svg = '<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>';
  const { pack } = await createPack(board.id, owner.id, { name: 'Brand', upload: await uploadZip(owner.id, { 'logo.svg': svg }) });

  // One colour: recoloured on the board like a library icon.
  expect(pack.icons[0]).toMatchObject({ name: 'logo', art: 'mono', nodes: [['path', { d: 'M2 2h20v20H2z', fill: 'currentColor', stroke: 'none' }]] });
  expect(await listPacks(board.id, member.id)).toMatchObject({ canManage: false, packs: [{ id: pack.id, name: 'Brand' }] });
  expect(await listPacks(board.id, guest.id)).toMatchObject({ canManage: false, packs: [{ id: pack.id }] });

  // On the board, but not in the workspace: no packs, and none to reach.
  const outsider = await person('Outsider');
  await inviteBoardMember(null, board.id, owner, { email: outsider.email, role: 'editor' });
  expect(await listPacks(board.id, outsider.id)).toEqual({ packs: [], canManage: false });
  await expect(removePack(pack.id, outsider.id)).rejects.toMatchObject({ status: 404 });

  // A member can't upload one (their file is left alone) or remove one; nor can anyone use another person's upload.
  const theirs = await uploadZip(member.id, { 'x.svg': svg });
  await expect(createPack(board.id, member.id, { name: 'Mine', upload: theirs })).rejects.toMatchObject({ status: 403 });
  await expect(createPack(board.id, owner.id, { name: 'Taken', upload: theirs })).rejects.toMatchObject({ status: 400, code: 'shape_pack_upload' });
  expect(await readUpload(theirs)).not.toBeNull();
  await expect(removePack(pack.id, member.id)).rejects.toMatchObject({ status: 403 });

  await removePack(pack.id, owner.id);
  expect((await listPacks(board.id, member.id)).packs).toEqual([]);
});

it('a personal pack follows its owner to boards of other workspaces, and nobody else — not even the workspace’s owner — sees, renames or removes it', async () => {
  const { owner, member, board } = await team();
  const svg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>';
  // A plain member (no right to upload the workspace's packs) keeps one of their own.
  const { pack } = await createPack(board.id, member.id, { name: 'My sketches', upload: await uploadZip(member.id, { 'dot.svg': svg }), personal: true });
  expect(pack).toMatchObject({ personal: true, icons: [{ name: 'dot' }] });

  // Theirs on this board, and on a board of a workspace they are only invited to.
  expect((await listPacks(board.id, member.id)).packs).toMatchObject([{ id: pack.id, personal: true }]);
  const other = await team();
  await inviteBoardMember(null, other.board.id, other.owner, { email: member.email, role: 'viewer' });
  expect((await listPacks(other.board.id, member.id)).packs.map((p) => p.id)).toEqual([pack.id]);

  // Nobody else's library, the workspace owner's included; they can't reach it either.
  expect((await listPacks(board.id, owner.id)).packs).toEqual([]);
  await expect(renamePack(pack.id, owner.id, { name: 'Ours now' })).rejects.toMatchObject({ status: 404 });
  await expect(removePack(pack.id, owner.id)).rejects.toMatchObject({ status: 404 });

  await removePack(pack.id, member.id);
  expect((await listPacks(other.board.id, member.id)).packs).toEqual([]);
});
