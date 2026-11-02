// A person's own view settings on a board, against a real database (in-memory Postgres).
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { listPersonalViews, savePersonalView } from './index';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@views.test.freero.app`, password: 'password-123' }, { emailVerified: true });

it("a person's own view settings are theirs alone: a viewer keeps some, a collaborator never reads them, someone without access keeps none, and clearing them is back to the saved view", async () => {
  const owner = await user('Owner');
  const viewer = await user('Viewer');
  const stranger = await user('Stranger');
  const b = await createBoard(owner.id, 'Sprint', '', 'none');
  await inviteBoardMember(null, b.id, owner, { email: viewer.email, role: 'viewer' });

  const mine = { card: { show: ['f_prio', '$due'], color: 'f_prio' } };
  await savePersonalView(b.id, viewer.id, { itemId: 'k1', viewId: 'board', settings: mine });
  await savePersonalView(b.id, owner.id, { itemId: 'k1', viewId: 'board', settings: { card: { color: 'own' } } });

  expect(await listPersonalViews(b.id, viewer.id)).toEqual([{ itemId: 'k1', viewId: 'board', settings: mine }]);
  expect(await listPersonalViews(b.id, owner.id)).toEqual([{ itemId: 'k1', viewId: 'board', settings: { card: { color: 'own' } } }]);
  await expect(savePersonalView(b.id, stranger.id, { itemId: 'k1', viewId: 'board', settings: mine })).rejects.toMatchObject({ status: 403 });
  await expect(listPersonalViews(b.id, stranger.id)).rejects.toMatchObject({ status: 403 });
  await expect(savePersonalView(b.id, viewer.id, { itemId: 'k1', viewId: 'board', settings: { blob: 'x'.repeat(5000) } })).rejects.toMatchObject({ status: 400 });

  await savePersonalView(b.id, viewer.id, { itemId: 'k1', viewId: 'board', settings: null });
  expect(await listPersonalViews(b.id, viewer.id)).toEqual([]);
});
