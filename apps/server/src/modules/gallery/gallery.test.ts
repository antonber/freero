// The community template gallery (#162) on real boards (in-memory Postgres, local storage): what a
// submission carries, and what the public can reach as moderation decides (decideGalleryTemplate
// is what modules/moderation's actions apply), through the services the routes use.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { BoardElement } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { initStorage } from '../../platform/storage';
import { createUser, getAccount } from '../auth/index';
import { createBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { initBoardDoc, initBoardLayer, readBoardView } from '../realtime/index';
import { fillShell } from '../site/index';
import { decideGalleryTemplate, installTemplate, ownTemplates, previewFor, publicTemplate, publicTemplates, reportableGalleryTemplate, submitTemplate } from './service';

let dir = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-gallery-'));
  initStorage(await openTestDb({ FREERO_DATA_DIR: dir }));
});
afterAll(async () => {
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
const account = async (name: string) =>
  getAccount((await createUser({ name, email: `${name.toLowerCase()}-${++n}@gallery.test.freero.app`, password: 'password-123' }, { emailVerified: true })).id);

let z = 0;
const el = (id: string, type: string, extra: Record<string, unknown>): BoardElement =>
  ({ id, type, x: ++z * 260, y: 0, w: 200, h: 200, rotation: 0, z, createdBy: 'author-user-id', createdAt: 1, updatedAt: 1, ...extra }) as BoardElement;
const sticky = (id: string, text: string, extra: Record<string, unknown> = {}) =>
  el(id, 'sticky', { text, color: 'yellow', fontFamily: 'sans', fontSize: 'auto', textColor: '#000', align: 'center', vAlign: 'middle', ...extra });
const docOf = (collections: Record<string, Record<string, unknown>>) => {
  const doc = new Y.Doc();
  for (const [name, entries] of Object.entries(collections)) for (const [k, v] of Object.entries(entries)) doc.getMap(name).set(k, v);
  return Y.encodeStateAsUpdate(doc);
};

/** A retro board with everything a public copy must not carry, beside what it should. */
async function retroBoard(ownerId: string) {
  const b = await createBoard(ownerId, 'Team retro', '', 'none');
  const elements = [
    sticky('went-well', 'What went well?', { createdVia: { appId: 'app', name: 'Claude' }, suggestedBy: { kind: 'person', name: 'Maria Lopez', userId: 'maria-id' } }),
    el('action', 'card', { title: 'Follow up', assigneeId: 'maria-id', values: { $assignee: 'maria-id' }, trackerLink: { id: 'ISSUE-1' }, lockProtected: true, locked: true }),
    el('grid', 'table', { rows: [{ id: 'r1', h: 40 }], cols: [{ id: 'c1', w: 100 }] }),
    el('vault', 'frame', { title: 'Vault', hidden: true, w: 600, h: 400 }),
    el('link', 'objectlink', { objectId: 'private-board', title: 'Salary planning board' }),
    el('file', 'file', { name: 'contract.pdf', src: '/uploads/abcdefgh.bin' }),
  ];
  await initBoardDoc(
    b.id,
    docOf({
      elements: Object.fromEntries(elements.map((e) => [e.id, e])),
      tableCells: { 't:grid:r1:c1': { text: 'Kept cell' } },
      comments: { 't:th1': { elementId: 'went-well', x: 0, y: 0 }, 'm:th1:m1': { text: 'COMMENT from Maria: ship it', authorId: 'maria-id', authorName: 'Maria Lopez' } },
      voting: { 'b:went-well:maria-id': 1 },
      presenterNotes: { vault: 'PRESENTER notes' },
    }),
  );
  await initBoardLayer(b.id, 'editors', docOf({ elements: { salary: sticky('salary', 'HIDDEN salary bands', { frameId: 'vault' }) } }));
  await initBoardLayer(b.id, `u:${ownerId}`, docOf({ elements: { draft: sticky('draft', 'PRIVATE draft: fire the vendor', { createdBy: ownerId }) } }));
  return b;
}

const submit = (user: Awaited<ReturnType<typeof account>>, boardId: string, title = 'Team retro') =>
  submitTemplate(user, { boardId, title, description: 'A retro in three columns.', category: 'retrospectives', licence: 'cc-by-4.0', author: 'Ann' });

it('a published template carries only the board’s shared items — never comments, votes, hidden-frame or draft content, links to other boards, files, or who made or is assigned what', async () => {
  const [ann, reader] = await Promise.all([account('Ann'), account('Reader')]);
  const board = await retroBoard(ann.id);
  const t = await submit(ann, board.id);
  expect(await decideGalleryTemplate(t.id, 'approve', '')).toBe(true);

  // Its preview is drawn from the copy: nothing withheld shows up in the picture either.
  const preview = (await previewFor(t.id, { userId: null, operator: false }))!;
  for (const secret of ['HIDDEN', 'PRIVATE', 'COMMENT', 'Salary planning', 'contract.pdf']) expect(preview).not.toContain(secret);
  expect(preview).toContain('What went');

  // Someone else installs it: their new board holds the clean copy, made by them.
  const { boardId } = await installTemplate(reader.id, t.id, {});
  const view = await readBoardView(boardId, { userId: reader.id, role: 'owner' });
  const raw = JSON.stringify({ elements: view.elements.map((e) => e.el), comments: [...view.collection('comments')], voting: [...view.collection('voting')], notes: [...view.collection('presenterNotes')] });
  expect(view.elements.map((e) => e.el.id).sort()).toEqual(['action', 'grid', 'went-well']);
  for (const secret of ['HIDDEN', 'PRIVATE', 'COMMENT', 'PRESENTER', 'maria-id', 'Maria', 'author-user-id', 'ISSUE-1', 'Claude', 'lockProtected']) expect(raw).not.toContain(secret);
  expect(view.elements.every((e) => e.el.createdBy === reader.id)).toBe(true);
  // What the template is made of comes along: the table's cells.
  expect(view.collection('tableCells').get('t:grid:r1:c1')).toEqual({ text: 'Kept cell' });
});

it('a template is public only while approved: pending, declined and removed ones are not found anywhere — page, preview, install, report — and restoring brings it back', async () => {
  const [ann, reader] = await Promise.all([account('Ann'), account('Reader')]);
  const board = await retroBoard(ann.id);
  const t = await submit(ann, board.id, 'Sailboat retro');
  const gone = async () => {
    expect(await publicTemplate(t.id)).toBeNull();
    expect((await publicTemplates('sailboat', null)).map((x) => x.id)).not.toContain(t.id);
    expect(await previewFor(t.id, { userId: null, operator: false })).toBeNull();
    await expect(installTemplate(reader.id, t.id, {})).rejects.toMatchObject({ status: 404 });
    // What moderation's report path asks before accepting a report (else 404).
    expect(await reportableGalleryTemplate(t.id)).toBeNull();
  };

  // Waiting for review: hidden from everyone but its submitter (and operators).
  await gone();
  expect(await previewFor(t.id, { userId: ann.id, operator: false })).not.toBeNull();
  expect((await ownTemplates(ann.id)).map((x) => [x.id, x.status])).toEqual([[t.id, 'pending']]);

  expect(await decideGalleryTemplate(t.id, 'approve', '')).toBe(true);
  expect((await publicTemplates('sailboat', 'retrospectives')).map((x) => x.id)).toEqual([t.id]);
  expect(await reportableGalleryTemplate(t.id)).toMatchObject({ id: t.id });

  // Taken down: gone at once, and the submitter reads why.
  expect(await decideGalleryTemplate(t.id, 'remove', 'It copies someone else’s work.')).toBe(true);
  await gone();
  // A decision that doesn't apply changes nothing (moderation answers 409 and records nothing).
  expect(await decideGalleryTemplate(t.id, 'reject', 'Too late')).toBe(false);
  expect((await ownTemplates(ann.id))[0]).toMatchObject({ status: 'removed', statusNote: 'It copies someone else’s work.' });

  expect(await decideGalleryTemplate(t.id, 'restore', '')).toBe(true);
  expect(await publicTemplate(t.id)).toMatchObject({ id: t.id, title: 'Sailboat retro', author: 'Ann', licence: 'cc-by-4.0' });
});

it('only someone who can edit the board submits it, and a viewer’s attempt copies nothing', async () => {
  const [ann, viewer] = await Promise.all([account('Ann'), account('Viewer')]);
  const board = await retroBoard(ann.id);
  await inviteBoardMember(null, board.id, ann, { email: viewer.email, role: 'viewer' });
  await expect(submit(viewer, board.id)).rejects.toMatchObject({ status: 403 });
  expect(await ownTemplates(viewer.id)).toEqual([]);
});

it('a submitter’s title can’t break out of the public page’s markup or its structured data', () => {
  const shell =
    '<title>__freero_shell_title__</title><link rel="canonical" href="https://x.test/__freero_shell_path__"/><script type="application/ld+json">{"name":"__freero_shell_title__"}</script><h1>__freero_shell_name__</h1><div data-freero-slot="body"></div>';
  const evil = '</script><script>alert(1)</script>"&';
  const html = fillShell(shell, { title: evil, description: 'd', name: evil, path: '/gallery/abc123' }, '<p>ok</p>');
  expect(html).not.toContain('<script>alert');
  expect(html.match(/<\/script>/g)).toHaveLength(1);
  // The JSON-LD still parses, and says exactly what was written.
  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1];
  expect(JSON.parse(ld)).toEqual({ name: evil });
  expect(html).toContain('href="https://x.test/gallery/abc123"');
  expect(() => fillShell(shell, { title: 't', description: 'd', name: 'n', path: '/gallery/"><script>' }, '')).toThrow();
});
