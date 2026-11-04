// Board content of a workspace with an encryption key (#159; modules/keys): what is at rest, what
// opens, and what never does.
import * as Y from 'yjs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { createKey, destroyKey, forgetAllCachedKeys, KeyUnavailableError, resumeKey, rotateKey, sealPendingContent, suspendKey } from '../keys/index';
import { boardAccess, createTeamWorkspace } from '../workspaces/index';
import * as docStore from './docStore';
import * as layerStore from './layerStore';
import * as repo from './repo';
import { storedBoardView } from './stored';
import { boardUploadReferences } from './uploadRefs';

beforeAll(async () => {
  await openTestDb({ WORKSPACE_KEYS: 'true' });
});
afterAll(closeTestDb);

let n = 0;
async function owner() {
  return createUser({ name: `Owner ${++n}`, email: `owner${n}@keys.test.freero.app`, password: 'password-123' }, { emailVerified: true });
}

const SECRET = 'Q3 acquisition target: Northwind';
const IMAGE = '/uploads/AbCdEf123456.png';

let el = 0;
/** An update adding a sticky with `text` (and an image): each one a new element, so updates merge without conflicts. */
function content(text: string, src = IMAGE): Uint8Array {
  const doc = new Y.Doc();
  const id = `e${++el}`;
  doc.getMap('elements').set(id, { id, type: 'sticky', x: 0, y: 0, w: 10, h: 10, text });
  doc.getMap('elements').set(`${id}i`, { id: `${id}i`, type: 'image', x: 0, y: 0, w: 10, h: 10, src });
  return Y.encodeStateAsUpdate(doc);
}
/** Every sticky's text in a stored state, sorted. */
const textOf = (state: Uint8Array | null) => {
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, state);
  return [...doc.getMap('elements').values()]
    .map((v) => (v as { text?: string }).text)
    .filter((t): t is string => !!t)
    .sort()
    .join(' | ');
};
const BOTH = `${SECRET} | ${SECRET} (v2)`;
const plainAtRest = (rows: repo.StoredRow[]) => rows.some((r) => Buffer.from(r.data).toString('latin1').includes(SECRET.slice(0, 12)));

/** A team workspace with a key, and a board with content in every table: base, log, a version, a private layer. */
async function keyedBoard(ws?: { id: string; ownerId: string }) {
  const me = ws ? { id: ws.ownerId } : await owner();
  const workspaceId = ws?.id ?? (await createTeamWorkspace(me.id, `Keyed ${n}`)).id;
  if (!ws) await createKey(workspaceId, me.id, {});
  const board = await createBoard(me.id, 'Plans', '', 'none', { workspaceId });
  await docStore.saveInitialState(board.id, content(SECRET));
  await docStore.appendUpdates(board.id, [content(`${SECRET} (v2)`)]);
  await repo.insertSnapshot(board.id, { state: content(SECRET), kind: 'named', name: 'Before the call', createdBy: me.id }, Date.now());
  await layerStore.saveInitialLayer(board.id, `u:${me.id}`, content(`${SECRET} draft`));
  return { me, workspaceId, board };
}

it("a keyed workspace's board content never reaches the database in the clear — base, log, versions, layers — and still opens as the board", async () => {
  const { board, me } = await keyedBoard();
  const rows = await repo.storedRowsOf(board.id);
  expect(rows.filter((r) => !repo.isEmptyPlaceholder(r)).length).toBeGreaterThanOrEqual(4);
  expect(rows.filter((r) => !repo.isEmptyPlaceholder(r)).every((r) => r.sealedWith !== null)).toBe(true);
  expect(plainAtRest(rows)).toBe(false);

  forgetAllCachedKeys(); // another instance, nothing in memory
  expect(textOf((await docStore.loadDoc(board.id)).state)).toBe(BOTH);
  const [layer] = await layerStore.loadLayers(board.id);
  expect(textOf(layer.state)).toBe(`${SECRET} draft`);
  const [version] = await docStore.listSnapshots(board.id);
  expect(textOf(await docStore.loadSnapshot(board.id, version.id))).toBe(SECRET);
  expect(layer.layer).toBe(`u:${me.id}`);
});

it('an instance of an older release (reading rows as plain Yjs during a rolling deploy) fails on every sealed row instead of applying ciphertext as content', async () => {
  const { board } = await keyedBoard();
  const sealed = (await repo.storedRowsOf(board.id)).filter((r) => r.sealedWith !== null);
  expect(sealed.length).toBeGreaterThan(0);
  for (const r of sealed) {
    expect(() => Y.applyUpdate(new Y.Doc(), r.data)).toThrow();
    expect(() => Y.mergeUpdates([r.data, r.data])).toThrow();
  }
});

it("a sealed blob copied into another board's row, another person's private layer or another workspace's board never opens", async () => {
  const a = await keyedBoard();
  const sibling = await createBoard(a.me.id, 'Other', '', 'none', { workspaceId: a.workspaceId });
  await docStore.saveInitialState(sibling.id, content('harmless'));
  const other = await keyedBoard();

  const source = (await repo.storedRowsOf(a.board.id)).find((r) => r.table === 'doc')!;
  for (const victim of [sibling.id, other.board.id]) {
    const target = (await repo.storedRowsOf(victim)).find((r) => r.table === 'doc')!;
    // Someone with write access to the database moves the ciphertext (and its key reference) over.
    await repo.replaceStoredRows(victim, [{ ...target, next: { data: Buffer.from(source.data), sealedWith: source.sealedWith } }], { ref: null, refs: new Set(), seal: () => ({ data: Buffer.alloc(0), sealedWith: null }) });
    await expect(docStore.loadDoc(victim)).rejects.toBeInstanceOf(KeyUnavailableError);
  }

  // A private draft relabelled as someone else's layer.
  const draft = (await repo.storedRowsOf(a.board.id)).find((r) => r.table === 'layer')!;
  await layerStore.saveInitialLayer(a.board.id, 'u:someone-else', content('their own'));
  const theirs = (await repo.storedRowsOf(a.board.id)).find((r) => r.table === 'layer' && r.layer === 'u:someone-else')!;
  await repo.replaceStoredRows(a.board.id, [{ ...theirs, next: { data: Buffer.from(draft.data), sealedWith: draft.sealedWith } }], { ref: null, refs: new Set(), seal: () => ({ data: Buffer.alloc(0), sealedWith: null }) });
  await expect(layerStore.loadLayer(a.board.id, 'u:someone-else')).rejects.toBeInstanceOf(KeyUnavailableError);
});

it('a suspended key closes the boards on every instance with no plaintext fallback and nothing written in the clear; resuming opens them again', async () => {
  const { me, workspaceId, board } = await keyedBoard();
  await suspendKey(workspaceId, me.id);
  forgetAllCachedKeys(); // another instance: its key rows were invalidated, its data keys expired

  expect((await boardAccess(me.id, { workspaceId, projectId: null })).blocked).toBe('key_unavailable');
  await expect(docStore.loadDoc(board.id)).rejects.toBeInstanceOf(KeyUnavailableError);
  // Derived indexes (search, references) read it as empty, so they hold nothing from it.
  expect(await storedBoardView(board.id)).toBeNull();
  const before = (await repo.storedRowsOf(board.id)).length;
  await expect(docStore.appendUpdates(board.id, [content('typed after the suspension')])).rejects.toBeInstanceOf(KeyUnavailableError);
  expect((await repo.storedRowsOf(board.id)).length).toBe(before);

  await resumeKey(workspaceId, me.id);
  expect((await boardAccess(me.id, { workspaceId, projectId: null })).blocked).toBeNull();
  expect(textOf((await docStore.loadDoc(board.id)).state)).toBe(BOTH);
});

it('a destroyed key makes the content unreadable for good, even on the instance that held its data key, and it cannot be resumed', async () => {
  const { me, workspaceId, board } = await keyedBoard();
  expect(textOf((await docStore.loadDoc(board.id)).state)).toBe(BOTH); // data key now cached here
  await expect(destroyKey(workspaceId, me.id, { confirm: 'not the name' })).rejects.toMatchObject({ status: 403 });
  await destroyKey(workspaceId, me.id, { confirm: `Keyed ${n}` });
  await expect(docStore.loadDoc(board.id)).rejects.toBeInstanceOf(KeyUnavailableError);
  await expect(resumeKey(workspaceId, me.id)).rejects.toMatchObject({ status: 409 });
  expect(plainAtRest(await repo.storedRowsOf(board.id))).toBe(false);
});

it('rotating the key keeps every board readable — content under the previous data key too — and the background job reseals it under the new one', async () => {
  const { me, workspaceId, board } = await keyedBoard();
  const status = await rotateKey(workspaceId, me.id, {});
  expect(status.key?.dataKeyVersion).toBe(2);
  forgetAllCachedKeys();
  expect(textOf((await docStore.loadDoc(board.id)).state)).toBe(BOTH);
  expect(status.key?.pendingBoards).toBeGreaterThanOrEqual(1);

  await sealPendingContent();
  const rows = (await repo.storedRowsOf(board.id)).filter((r) => !repo.isEmptyPlaceholder(r));
  expect(rows.every((r) => r.sealedWith === `${workspaceId}:2`)).toBe(true);
  forgetAllCachedKeys();
  expect(textOf((await docStore.loadDoc(board.id)).state)).toBe(BOTH);
  expect(textOf(await docStore.loadSnapshot(board.id, (await docStore.listSnapshots(board.id))[0].id))).toBe(SECRET);
});

it('turning a key on seals the content stored before it, which keeps opening meanwhile', async () => {
  const me = await owner();
  const workspaceId = (await createTeamWorkspace(me.id, `Later ${n}`)).id;
  const board = await createBoard(me.id, 'Old plans', '', 'none', { workspaceId });
  await docStore.saveInitialState(board.id, content(SECRET));
  expect(plainAtRest(await repo.storedRowsOf(board.id))).toBe(true);

  await createKey(workspaceId, me.id, {});
  await sealPendingContent();
  expect(plainAtRest(await repo.storedRowsOf(board.id))).toBe(false);
  expect(textOf((await docStore.loadDoc(board.id)).state)).toBe(SECRET);
});

it("the uploads sweep keeps a file only an encrypted board references, also while the board's key is suspended", async () => {
  const name = 'OnlyHere9876.png';
  const { me, workspaceId, board } = await keyedBoard();
  await docStore.appendUpdates(board.id, [content('with a picture', `/uploads/${name}`)]);
  // Sealed bytes hold no URL a pattern could find…
  expect((await repo.storedRowsOf(board.id)).some((r) => Buffer.from(r.data).toString('latin1').includes(name))).toBe(false);
  await suspendKey(workspaceId, me.id);
  forgetAllCachedKeys();
  // …yet the sweep's scan still sees the file referenced.
  expect(await boardUploadReferences([name])).toEqual([name]);
});
