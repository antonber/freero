// SESSION_SECRET rotation (docs/operations.md) must never leave a workspace's content unreadable:
// data keys wrapped by the instance's key open under SESSION_SECRET_PREVIOUS during the rotation,
// the background job wraps every one of them again — also those of workspaces nobody opened
// meanwhile — and afterwards the previous secret is no longer needed.
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { loadConfig } from '../../platform/config';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { initBoardDoc, storedBoardView } from '../realtime/index';
import { createTeamWorkspace } from '../workspaces/index';
import { createKey, forgetAllCachedKeys, rewrapInstanceKeys } from './service';

const OLD = 'rotation-test-secret-OLD-0123456789abcdefghij';
const NEW = 'rotation-test-secret-NEW-0123456789abcdefghij';
/** Restarts the config with these secrets, as a fresh instance would (nothing cached). */
function restartWith(current: string, previous: string[] = []) {
  loadConfig({ NODE_ENV: 'test', FREERO_DATA_DIR: 'memory', WORKSPACE_KEYS: 'true', SESSION_SECRET: current, ...(previous.length ? { SESSION_SECRET_PREVIOUS: previous.join(',') } : {}) });
  forgetAllCachedKeys();
}

beforeAll(() => openTestDb({ SESSION_SECRET: OLD, WORKSPACE_KEYS: 'true' }));
afterAll(() => closeTestDb());

async function keyedBoard(ownerId: string, name: string) {
  const ws = (await createTeamWorkspace(ownerId, name)).id;
  await createKey(ws, ownerId, {});
  const board = await createBoard(ownerId, name, '', 'none', { workspaceId: ws });
  const doc = new Y.Doc();
  doc.getMap('elements').set('s1', { id: 's1', type: 'sticky', x: 0, y: 0, w: 1, h: 1, text: `${name} note` });
  await initBoardDoc(board.id, Y.encodeStateAsUpdate(doc));
  return board.id;
}
const readable = async (boardId: string) => ((await storedBoardView(boardId))?.elements.length ?? 0) === 1;

it('rotating SESSION_SECRET keeps every keyed workspace readable: boards open during the rotation, the job rewraps every data key (used or not), and the old secret is then not needed', async () => {
  const me = await createUser({ name: 'Operator', email: 'rotation@keys.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const used = await keyedBoard(me.id, 'Used');
  const idle = await keyedBoard(me.id, 'Idle');

  restartWith(NEW, [OLD]);
  expect(await readable(used)).toBe(true); // opens with the previous secret (and is rewrapped on use)
  // The workspace nobody opened is rewrapped by the job, not left behind.
  const first = await rewrapInstanceKeys(); // 'used' may already be rewrapped on use
  expect(first.unreadable).toBe(0);
  expect(first.rewrapped).toBeGreaterThanOrEqual(1);
  expect(await rewrapInstanceKeys()).toEqual({ rewrapped: 0, unreadable: 0 });

  restartWith(NEW);
  expect(await readable(used)).toBe(true);
  expect(await readable(idle)).toBe(true);

  // Had the previous secret been dropped too early, the job says so instead of hiding it.
  restartWith('rotation-test-secret-LOST-0123456789abcdefghij');
  expect((await rewrapInstanceKeys()).unreadable).toBe(2);
  expect(await readable(idle)).toBe(false);
});
