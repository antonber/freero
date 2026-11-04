// WORKSPACE_KEYS is off by default (#159): a deploy must not start sealing anything. With it off no
// workspace can turn a key on and content is stored as it always was; a key turned on while the
// feature was on keeps its workspace sealed and readable after it is turned off again.
import * as Y from 'yjs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadConfig } from '../../platform/config';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { createKey, forgetAllCachedKeys } from '../keys/index';
import { createTeamWorkspace } from '../workspaces/index';
import * as docStore from './docStore';
import * as repo from './repo';

beforeAll(() => openTestDb()); // the default configuration
afterAll(closeTestDb);

const restart = (env: Record<string, string> = {}) => {
  loadConfig({ NODE_ENV: 'test', FREERO_DATA_DIR: 'memory', ...env });
  forgetAllCachedKeys();
};
const sticky = (text: string) => {
  const doc = new Y.Doc();
  doc.getMap('elements').set(text, { id: text, type: 'sticky', x: 0, y: 0, w: 1, h: 1, text });
  return Y.encodeStateAsUpdate(doc);
};
const text = (state: Uint8Array | null) => {
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, state);
  return [...doc.getMap('elements').keys()].sort().join(',');
};
const sealedRows = async (boardId: string) => (await repo.storedRowsOf(boardId)).filter((r) => !repo.isEmptyPlaceholder(r) && r.sealedWith !== null).length;

it('with WORKSPACE_KEYS at its default nothing is sealed and no workspace can turn a key on; a key turned on while it was on keeps working once it is off again', async () => {
  const me = await createUser({ name: 'Admin', email: 'off@keys.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const plainWs = (await createTeamWorkspace(me.id, 'Plain')).id;
  await expect(createKey(plainWs, me.id, {})).rejects.toMatchObject({ status: expect.any(Number) });
  const plain = await createBoard(me.id, 'Plain board', '', 'none', { workspaceId: plainWs });
  await docStore.saveInitialState(plain.id, sticky('a'));
  await docStore.appendUpdates(plain.id, [sticky('b')]);
  expect(await sealedRows(plain.id)).toBe(0);

  // Turned on, a workspace seals; turned off again, that workspace stays sealed and readable.
  restart({ WORKSPACE_KEYS: 'true' });
  const keyedWs = (await createTeamWorkspace(me.id, 'Keyed')).id;
  await createKey(keyedWs, me.id, {});
  const keyed = await createBoard(me.id, 'Keyed board', '', 'none', { workspaceId: keyedWs });
  await docStore.saveInitialState(keyed.id, sticky('c'));
  restart();
  await docStore.appendUpdates(keyed.id, [sticky('d')]);
  expect(await sealedRows(keyed.id)).toBe(2);
  expect(text((await docStore.loadDoc(keyed.id)).state)).toBe('c,d');
  await docStore.appendUpdates(plain.id, [sticky('e')]);
  expect(await sealedRows(plain.id)).toBe(0);
});
