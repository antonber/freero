// Moving a board between workspaces with encryption keys (#159): its stored content follows it to
// the target's key, so the source's key no longer has any say over it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { initStorage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createKey, forgetAllCachedKeys, sealPendingContent, suspendKey } from '../keys/index';
import { boardsNeedingReseal, initBoardDoc, storedBoardView } from '../realtime/index';
import { followBoardMoves, readUpload, saveUpload } from '../uploads/index';
import { createTeamWorkspace } from '../workspaces/index';
import * as repo from './repo';
import { createBoard, moveToWorkspace } from './service';

// When armed: an open room saves while the move is under way (after the reseal for the target,
// before the move commits), and the reseal after the move then fails.
const move = vi.hoisted(() => ({ saveMeanwhile: null as null | (() => Promise<void>) }));
vi.mock('../realtime/index', async (importOriginal) => {
  const real = await importOriginal<typeof import('../realtime/index')>();
  return {
    ...real,
    resealBoard: async (boardId: string, workspaceId?: string) => {
      const save = move.saveMeanwhile;
      if (!save) return real.resealBoard(boardId, workspaceId);
      if (workspaceId !== undefined) {
        const n = await real.resealBoard(boardId, workspaceId);
        await save();
        return n;
      }
      move.saveMeanwhile = null;
      throw new Error('the key service timed out');
    },
  };
});

let dir = '';
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-keyed-move-'));
  initStorage(await openTestDb({ FREERO_DATA_DIR: dir, WORKSPACE_KEYS: 'true' }));
  followBoardMoves();
});
afterAll(async () => {
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

function sticky(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('elements').set('s1', { id: 's1', type: 'sticky', x: 0, y: 0, w: 10, h: 10, text });
  return Y.encodeStateAsUpdate(doc);
}
const textOn = async (boardId: string) => (await storedBoardView(boardId))?.elements.map(({ el }) => (el as { text?: string }).text).join() ?? null;

it("a board moved from workspace A to B is under B's key: suspending A neither exposes nor breaks it, while A's own boards close", async () => {
  const me = await createUser({ name: 'Mover', email: 'mover@keys.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const a = (await createTeamWorkspace(me.id, 'Alpha')).id;
  const b = (await createTeamWorkspace(me.id, 'Beta')).id;
  await createKey(a, me.id, {});
  await createKey(b, me.id, {});
  const moving = await createBoard(me.id, 'Moving', '', 'none', { workspaceId: a });
  const staying = await createBoard(me.id, 'Staying', '', 'none', { workspaceId: a });
  await initBoardDoc(moving.id, sticky('moving secret'));
  await initBoardDoc(staying.id, sticky('staying secret'));

  await moveToWorkspace((await repo.getBoard(moving.id))!, me.id, { workspaceId: b });
  expect(await boardsNeedingReseal([moving.id], `${b}:1`)).toEqual([]); // every row under B's data key

  await suspendKey(a, me.id);
  forgetAllCachedKeys();
  expect(await textOn(moving.id)).toBe('moving secret');
  expect(await textOn(staying.id)).toBeNull();
});

it('a board moved to a workspace without a key is stored as is there, and one moved into a keyed workspace is sealed for it', async () => {
  const me = await createUser({ name: 'Mover 2', email: 'mover2@keys.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const keyed = (await createTeamWorkspace(me.id, 'Keyed')).id;
  const plain = (await createTeamWorkspace(me.id, 'Plain')).id;
  await createKey(keyed, me.id, {});
  const board = await createBoard(me.id, 'Roundtrip', '', 'none', { workspaceId: plain });
  await initBoardDoc(board.id, sticky('roundtrip'));

  await moveToWorkspace((await repo.getBoard(board.id))!, me.id, { workspaceId: keyed });
  expect(await boardsNeedingReseal([board.id], `${keyed}:1`)).toEqual([]);
  await moveToWorkspace((await repo.getBoard(board.id))!, me.id, { workspaceId: plain });
  expect(await boardsNeedingReseal([board.id], null)).toEqual([]); // nothing sealed left
  // The keyed workspace's key no longer matters to it.
  await suspendKey(keyed, me.id);
  forgetAllCachedKeys();
  expect(await textOn(board.id)).toBe('roundtrip');
});

it("a moved board takes its own files to the target's key; a file a board left behind still shows stays the source's, so neither workspace's key decides the other's pictures", async () => {
  const me = await createUser({ name: 'Mover 3', email: 'mover3@keys.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const a = (await createTeamWorkspace(me.id, 'Alpha 3')).id;
  const b = (await createTeamWorkspace(me.id, 'Beta 3')).id;
  await createKey(a, me.id, {});
  await createKey(b, me.id, {});
  const png = (label: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]);
  const own = await saveUpload(png('only on the moving board'), 'image/png', me.id, { workspaceId: a });
  const shared = await saveUpload(png('also on a board that stays'), 'image/png', me.id, { workspaceId: a });
  const withImages = (srcs: string[]) => {
    const doc = new Y.Doc();
    srcs.forEach((src, i) => doc.getMap('elements').set(`i${i}`, { id: `i${i}`, type: 'image', x: 0, y: 0, w: 10, h: 10, src }));
    return Y.encodeStateAsUpdate(doc);
  };
  const moving = await createBoard(me.id, 'Moving 3', '', 'none', { workspaceId: a });
  const staying = await createBoard(me.id, 'Staying 3', '', 'none', { workspaceId: a });
  await initBoardDoc(moving.id, withImages([own, shared]));
  await initBoardDoc(staying.id, withImages([shared]));

  await moveToWorkspace((await repo.getBoard(moving.id))!, me.id, { workspaceId: b });
  await suspendKey(a, me.id);
  forgetAllCachedKeys();
  expect((await readUpload(own))?.toString('latin1')).toContain('only on the moving board');
  expect(await readUpload(shared)).toBeNull();
});

it("a save made during a move into a workspace without a key, left under the source's key when the reseal after the move failed, is opened by the background job, so the source's key no longer decides the board", async () => {
  const me = await createUser({ name: 'Mover 4', email: 'mover4@keys.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const keyed = (await createTeamWorkspace(me.id, 'Keyed 4')).id;
  const plain = (await createTeamWorkspace(me.id, 'Plain 4')).id;
  await createKey(keyed, me.id, {});
  const board = await createBoard(me.id, 'Leaving', '', 'none', { workspaceId: keyed });
  await initBoardDoc(board.id, sticky('before the move'));

  move.saveMeanwhile = () => initBoardDoc(board.id, sticky('saved during the move'));
  await moveToWorkspace((await repo.getBoard(board.id))!, me.id, { workspaceId: plain });
  expect(move.saveMeanwhile).toBeNull(); // the reseal after the move did fail
  expect(await boardsNeedingReseal([board.id], null)).toEqual([board.id]); // a row still under the source's key

  await sealPendingContent();
  expect(await boardsNeedingReseal([board.id], null)).toEqual([]);
  await suspendKey(keyed, me.id);
  forgetAllCachedKeys();
  expect(await textOn(board.id)).toBe('saved during the move');
});
