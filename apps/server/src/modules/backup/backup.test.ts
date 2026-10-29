// Board backups (KAI-137) against real stored boards, real uploads and real access rules (in-memory
// Postgres, uploads on a temp dir): what a `.freero` file carries, and what restoring one makes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { tableCellKey, type BoardElement } from '@freero/shared';
import { initStorage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { boardIdsOwnedByUser, createBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { initBoardDoc, initBoardLayer, readBoardView } from '../realtime/index';
import { deleteUpload, readUpload, saveUpload, uploadBytesUsed } from '../uploads/index';
import { createProject, createTeamWorkspace, inviteToWorkspace, updateWorkspace } from '../workspaces/index';
import { BackupFormatError, readBackup } from './format';
import { downloadBackup, readLimits, restoreBackup } from './service';

let dir = '';
let n = 0;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64 * 1024, 7)]);
const user = (name: string) => createUser({ name, email: `${name.toLowerCase()}${++n}@backup.test.freero.app`, password: 'password-123' }, { emailVerified: true });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-backup-'));
  // 1 MB of uploads per account: enough for a few test images, small enough to run out.
  initStorage(await openTestDb({ FREERO_DATA_DIR: dir, UPLOAD_QUOTA_MB: '1' }));
});
afterAll(async () => {
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const share = (boardId: string, owner: { email: string }, who: { email: string }, role: 'editor' | 'viewer') =>
  inviteBoardMember(null, boardId, { ...owner, emailVerified: true } as never, { email: who.email, role });

let z = 0;
const el = (type: string, id: string, extra: Record<string, unknown> = {}) =>
  ({ id, type, x: 0, y: 0, w: 100, h: 100, rotation: 0, z: ++z, createdBy: 'someone', createdAt: 1, updatedAt: 1, ...extra }) as unknown as BoardElement;

function state(collections: Record<string, Record<string, unknown>>): Uint8Array {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const [name, entries] of Object.entries(collections)) for (const [k, v] of Object.entries(entries)) doc.getMap(name).set(k, v);
  });
  return Y.encodeStateAsUpdate(doc);
}

const IDS = { sticky: 'sticky-aaaaaaaaaaaa', other: 'sticky-bbbbbbbbbbbb', line: 'connector-cccccccccc', table: 'table-dddddddddddd', image: 'image-eeeeeeeeeeee', frame: 'frame-ffffffffffff', secret: 'sticky-hidden-gggggg', draft: 'sticky-draft-hhhhhhh', photo: 'image-iiiiiiiiiiii' };

/** A board with a bit of everything: linked stickies, a table, a comment, a tag, an image, a hidden frame's contents, someone's private draft and a running vote. */
async function richBoard(ownerId: string, draftAuthor: string) {
  const board = await createBoard(ownerId, 'Launch plan', 'Q4');
  const image = await saveUpload(PNG, 'image/png', ownerId);
  const photo = await saveUpload(Buffer.concat([PNG, Buffer.from([1])]), 'image/png', ownerId);
  const cell = tableCellKey('t', IDS.table, 'r1', 'c1');
  await initBoardDoc(
    board.id,
    state({
      elements: {
        [IDS.sticky]: el('sticky', IDS.sticky, { text: 'See <a href="#sticky-bbbbbbbbbbbb">the other one</a>', tags: ['t1'] }),
        [IDS.other]: el('sticky', IDS.other, { text: 'Other', trackerLink: { id: 'link-1' } }),
        [IDS.line]: el('connector', IDS.line, { start: { elementId: IDS.sticky, x: 0, y: 0 }, end: { elementId: IDS.other, x: 0, y: 0 } }),
        [IDS.table]: el('table', IDS.table, { rows: ['r1'], cols: ['c1'] }),
        [IDS.image]: el('image', IDS.image, { src: image }),
        [IDS.frame]: el('frame', IDS.frame, { title: 'Secret', hidden: true }),
        [IDS.photo]: el('image', IDS.photo, { src: photo }),
      },
      settings: { background: '#fafafa' },
      tags: { t1: { id: 't1', name: 'Launch', color: 'blue' } },
      tableCells: { [cell]: 'Budget' },
      comments: {
        't:th1': { kind: 'thread', id: 'th1', elementId: IDS.sticky, createdBy: ownerId, createdAt: 1 },
        'm:th1:m1': { kind: 'message', id: 'm1', threadId: 'th1', authorId: ownerId, authorName: 'Owner', text: 'Ship it?', createdAt: 2 },
      },
      voting: { session: { id: 'v1', running: true } },
    }),
  );
  await initBoardLayer(board.id, 'editors', state({ elements: { [IDS.secret]: el('sticky', IDS.secret, { text: 'Salary bands', frameId: IDS.frame }) } }));
  await initBoardLayer(board.id, `u:${draftAuthor}`, state({ elements: { [IDS.draft]: el('sticky', IDS.draft, { text: 'My private idea' }) } }));
  return { board, image };
}

it('a restored backup is the same board under fresh ids — links, cells, comments, tags and images intact — and never carries anyone’s draft or a live session', async () => {
  const owner = await user('Owner');
  const drafter = await user('Drafter');
  const { board, image } = await richBoard(owner.id, drafter.id);
  await share(board.id, owner, drafter, 'editor');
  const team = await createTeamWorkspace(owner.id, 'Studio');
  const project = await createProject(team.id, owner.id, { name: 'Archive' });

  const { data } = await downloadBackup(board.id, owner.id, 'https://old.freero.example');
  const files = unzipSync(data);
  expect(strFromU8(files['board.json'] ?? new Uint8Array()) + strFromU8(files['editors.json'] ?? new Uint8Array())).not.toContain('My private idea');

  const before = await uploadBytesUsed(owner.id);
  const out = await restoreBackup(owner.id, data, { workspaceId: team.id, projectId: project.id });
  expect(out.board).toMatchObject({ title: 'Launch plan', workspaceId: team.id, projectId: project.id });
  expect(out.report).toMatchObject({ files: 2, missingFiles: 0, hiddenContent: true });
  expect(await uploadBytesUsed(owner.id)).toBe(before + 2 * PNG.length + 1); // re-uploaded under the restorer's quota

  const view = await readBoardView(out.board.id, { userId: owner.id, role: 'owner' });
  const byText = (t: string) => view.elements.find((e) => String((e.el as { text?: string }).text ?? '').includes(t))!.el as BoardElement & Record<string, unknown>;
  const first = byText('See ');
  const other = byText('Other');
  const ids = view.elements.map((e) => e.el.id);
  expect(ids.filter((id) => Object.values(IDS).includes(id))).toEqual([]); // every element got a new id
  expect(first.text).toContain(`href="#${other.id}"`); // an item link follows its target
  expect(other.trackerLink).toBeUndefined(); // the tracker link's row is not this board's
  const line = view.elements.find((e) => e.el.type === 'connector')!.el as unknown as { start: { elementId: string }; end: { elementId: string } };
  expect([line.start.elementId, line.end.elementId]).toEqual([first.id, other.id]);
  const table = view.elements.find((e) => e.el.type === 'table')!.el;
  expect(view.collection('tableCells').get(tableCellKey('t', table.id, 'r1', 'c1'))).toBe('Budget');
  const thread = view.collection('comments').get('t:th1') as { elementId: string };
  expect(thread.elementId).toBe(first.id);
  expect((view.collection('comments').get('m:th1:m1') as { text: string }).text).toBe('Ship it?');
  expect(first.tags).toEqual(['t1']);
  expect(view.collection('tags').get('t1')).toMatchObject({ name: 'Launch' });
  expect(view.collection('voting').size).toBe(0); // a running vote is a session, not content
  // Both images point at new uploads of the restorer holding the same bytes.
  const srcs = view.elements.filter((e) => e.el.type === 'image').map((e) => (e.el as unknown as { src: string }).src);
  expect(srcs).not.toContain(image);
  const sizes = await Promise.all(srcs.map(async (s) => (await readUpload(s))?.length));
  expect(sizes.sort()).toEqual([PNG.length, PNG.length + 1]);
  // The hidden frame's contents came back hidden: in the editors layer, not the shared doc.
  const secret = view.elements.find((e) => (e.el as { text?: string }).text === 'Salary bands')!;
  expect(secret.layer).toBe('editors');
  const frame = view.elements.find((e) => e.el.type === 'frame')!.el;
  expect((secret.el as { frameId?: string }).frameId).toBe(frame.id);
  expect(view.elements.some((e) => (e.el as { text?: string }).text === 'My private idea')).toBe(false);
});

it('a viewer’s backup holds only what a viewer sees: no hidden frame’s contents', async () => {
  const owner = await user('Host');
  const viewer = await user('Viewer');
  const { board } = await richBoard(owner.id, owner.id);
  await share(board.id, owner, viewer, 'viewer');
  const files = unzipSync((await downloadBackup(board.id, viewer.id, null)).data);
  expect(files['editors.json']).toBeUndefined();
  expect(strFromU8(files['board.json'])).not.toContain('Salary bands');
});

it('a workspace that doesn’t allow downloads refuses a backup to whoever it doesn’t trust with exports', async () => {
  const owner = await user('Lead');
  const guest = await user('Guest');
  const ws = await createTeamWorkspace(owner.id, 'Locked');
  await inviteToWorkspace(null, ws.id, owner, { email: guest.email, role: 'guest' });
  const board = await createBoard(owner.id, 'Confidential', '', 'viewer', { workspaceId: ws.id });
  await updateWorkspace(ws.id, owner.id, { policies: { downloads: 'members' } });
  await expect(downloadBackup(board.id, guest.id, null)).rejects.toMatchObject({ status: 403 });
});

/** The file with `fn` applied to its entries, zipped again (the manifest's checksums unchanged). */
const tamper = (data: Uint8Array, fn: (entries: Record<string, Uint8Array>) => void) => {
  const entries = unzipSync(data);
  fn(entries);
  return zipSync(entries);
};
const manifestOf = (entries: Record<string, Uint8Array>) => JSON.parse(strFromU8(entries['freero.json'])) as Record<string, unknown>;

it('a changed, oversized or over-quota file creates no board and leaves no uploads behind', async () => {
  const owner = await user('Careful');
  const { board } = await richBoard(owner.id, owner.id);
  const { data } = await downloadBackup(board.id, owner.id, null);
  const count = async () => (await boardIdsOwnedByUser(owner.id)).length;
  const n0 = await count();

  const edited = tamper(data, (e) => {
    e['board.json'] = strToU8(strFromU8(e['board.json']).replace('Budget', 'Bribes'));
  });
  await expect(restoreBackup(owner.id, edited, { workspaceId: null, projectId: null })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/changed/) });

  await expect(restoreBackup(owner.id, new Uint8Array(readLimits().maxFileBytes + 1), { workspaceId: null, projectId: null })).rejects.toMatchObject({ status: 400 });

  // Quota (1 MB here): room for exactly one more image, and the backup carries two. The first is
  // re-uploaded, the second is refused — and the first must not stay behind, eating the quota.
  let last = '';
  for (;;) {
    try {
      last = await saveUpload(PNG, 'image/png', owner.id);
    } catch {
      break;
    }
  }
  await deleteUpload(last);
  const used = await uploadBytesUsed(owner.id);
  await expect(restoreBackup(owner.id, data, { workspaceId: null, projectId: null })).rejects.toMatchObject({ status: 413 });
  expect(await uploadBytesUsed(owner.id)).toBe(used);
  expect(await count()).toBe(n0);
});

it('a backup from a newer Freero restores when it says older readers understand it, and is refused with a clear message when it doesn’t', async () => {
  const owner = await user('Future');
  const { board } = await richBoard(owner.id, owner.id);
  const { data } = await downloadBackup(board.id, owner.id, null);
  const withManifest = (patch: Record<string, unknown>) =>
    tamper(data, (e) => {
      e['freero.json'] = strToU8(JSON.stringify({ ...manifestOf(e), ...patch }));
    });
  const additive = await restoreBackup(owner.id, withManifest({ version: 7, minReaderVersion: 1, somethingNew: true }), { workspaceId: null, projectId: null });
  expect(additive.report.source.formatVersion).toBe(7);
  await expect(restoreBackup(owner.id, withManifest({ version: 7, minReaderVersion: 7 }), { workspaceId: null, projectId: null })).rejects.toMatchObject({
    status: 400,
    message: expect.stringMatching(/newer version of Freero/),
  });
});

it('a ZIP whose entries claim more than the limits is refused before anything is unpacked (zip bombs), and unknown entries are never unpacked', () => {
  const big = zipSync({ 'freero.json': strToU8('{}'), 'board.json': new Uint8Array(4096) });
  const limits = { maxFileBytes: 1 << 20, maxUnpackedBytes: 1 << 20, maxJsonBytes: 1024, maxEntries: 10, maxKeys: 10 };
  expect(() => readBackup(big, limits)).toThrow(/too large/);
  const many = zipSync(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`files/aaaaaa${i}.png`, new Uint8Array(1)])));
  expect(() => readBackup(many, limits)).toThrow(BackupFormatError);
  const stray = zipSync({ '../../etc/passwd': strToU8('x'), 'freero.json': strToU8('{"format":"something-else"}') });
  expect(() => readBackup(stray, limits)).toThrow(/not a Freero board backup/);
});
