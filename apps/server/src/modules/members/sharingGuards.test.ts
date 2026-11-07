// Who may share a board is checked under the board's sharing lock, and an invite works only while
// the person who sent it may still invite people to the board.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb, outboxMails } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import { acceptInvite } from './invites';
import { inviteBoardMember, removeBoardMember, setBoardMemberRole } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const email = (label: string) => `${label.toLowerCase()}-${++n}@sharing-guards.test.freero.app`;
const user = (label: string): Promise<Account> => createUser({ name: label, email: email(label), password: 'password-123' }, { emailVerified: true });

/** A board of `owner` with `coOwner` as its co-owner. */
async function boardWithCoOwner(owner: Account, coOwner: Account) {
  const board = await createBoard(owner.id, `Board ${++n}`, '');
  await inviteBoardMember(null, board.id, owner, { email: coOwner.email, role: 'editor' });
  await setBoardMemberRole(board.id, owner.id, coOwner.id, 'coowner');
  return board;
}

it('a co-owner demoted a moment ago can’t make themselves co-owner again', async () => {
  const [owner, co] = await Promise.all([user('Owner'), user('Co')]);
  const board = await boardWithCoOwner(owner, co);
  // The owner demotes the co-owner while the co-owner (still one when its request arrived) re-asserts it.
  await Promise.allSettled([setBoardMemberRole(board.id, owner.id, co.id, 'viewer'), setBoardMemberRole(board.id, co.id, co.id, 'coowner')]);
  // Either order is fine as long as the demotion is the last word: had the co-owner's request gone
  // first, the demotion overrides it; after it, they no longer manage the board.
  const access = await getBoardAccess(board.id, co.id);
  expect({ role: access.role, coOwner: access.coOwner }).toEqual({ role: 'viewer', coOwner: false });
});

it('the invitations a co-owner sent stop working once they are removed from the board', async () => {
  const [owner, co] = await Promise.all([user('Owner'), user('Co')]);
  const board = await boardWithCoOwner(owner, co);
  const to = email('alt');
  await inviteBoardMember(null, board.id, co, { email: to, role: 'editor' });
  const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(outboxMails().filter((m) => m.to === to).at(-1)?.text ?? '')?.[1];
  expect(token).toBeDefined();
  await removeBoardMember(board.id, owner.id, co.id);
  const alt = await createUser({ name: 'Alt', email: to, password: 'password-123' });
  await expect(acceptInvite(token!, alt)).rejects.toMatchObject({ status: 404 });
  expect((await getBoardAccess(board.id, alt.id)).role).toBeNull();
});
