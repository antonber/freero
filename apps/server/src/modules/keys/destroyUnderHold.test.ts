// Destroying a workspace's key destroys its content, so a legal hold (#157) outranks it — also a hold
// that commits while the destroy is already under way (the check and the destruction are one step).
import * as Y from 'yjs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, placeLegalHold } from '../boards/index';
import { initBoardDoc, storedBoardView } from '../realtime/index';
import { createTeamWorkspace } from '../workspaces/index';
import { createKey, destroyKey, keyStatus } from './service';

// Runs once, after the destroy has started and before it changes the key: a case manager's hold
// committing at that moment.
const race = vi.hoisted(() => ({ meanwhile: null as null | (() => Promise<void>) }));
vi.mock('../boards/index', async (importOriginal) => {
  const real = await importOriginal<typeof import('../boards/index')>();
  return {
    ...real,
    boardIdsInWorkspace: async (workspaceId: string) => {
      const ids = await real.boardIdsInWorkspace(workspaceId);
      const meanwhile = race.meanwhile;
      race.meanwhile = null;
      if (meanwhile) await meanwhile();
      return ids;
    },
  };
});

beforeAll(() => openTestDb({ WORKSPACE_KEYS: 'true' }));
afterAll(closeTestDb);

it('a legal hold placed while the owner is destroying the workspace key stops the destroy, and the held board stays readable', async () => {
  const me = await createUser({ name: 'Owner', email: 'destroy@keys.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const ws = await createTeamWorkspace(me.id, 'Evidence');
  await createKey(ws.id, me.id, {});
  const board = await createBoard(me.id, 'Minutes', '', 'none', { workspaceId: ws.id });
  const doc = new Y.Doc();
  doc.getMap('elements').set('s1', { id: 's1', type: 'sticky', x: 0, y: 0, w: 1, h: 1, text: 'what was agreed' });
  await initBoardDoc(board.id, Y.encodeStateAsUpdate(doc));

  race.meanwhile = () => placeLegalHold('case-during-destroy', { boardIds: [board.id], custodians: [] });
  await expect(destroyKey(ws.id, me.id, { confirm: ws.name })).rejects.toMatchObject({ status: 409, code: 'legal_hold' });
  expect(race.meanwhile).toBeNull(); // the hold really came in mid-destroy
  expect((await keyStatus(ws.id, me.id)).key?.state).toBe('active');
  expect((await storedBoardView(board.id))?.elements).toHaveLength(1);
});
