// Moving a board between workspaces with encryption keys (#159): its stored content follows it to
// the target's key, so the source's key no longer has any say over it.
import * as Y from 'yjs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createKey, forgetAllCachedKeys, suspendKey } from '../keys/index';
import { boardsNeedingReseal, initBoardDoc, storedBoardView } from '../realtime/index';
import { createTeamWorkspace } from '../workspaces/index';
import * as repo from './repo';
import { createBoard, moveToWorkspace } from './service';

beforeAll(async () => {
  await openTestDb({ WORKSPACE_KEYS: 'true' });
});
afterAll(closeTestDb);

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
