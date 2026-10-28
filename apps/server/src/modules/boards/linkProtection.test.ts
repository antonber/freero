// Share-link password and expiry (KAI-145): the link's role reaches only people who gave the
// CURRENT password and only until the expiry; members never depend on the link.
import type { Request } from 'express';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { LINK_PASSWORD_REQUIRED, type User } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, markEmailVerified } from '../auth/index';
import { inviteBoardMember } from '../members/index';
import { getBoardAccess } from './index';
import { changeLinkProtection, unlockLink } from './linkProtection';
import * as repo from './repo';
import { createBoard, requireAccess } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
async function person(label: string): Promise<User> {
  const email = `${label.toLowerCase()}-${++n}@link.test.freero.app`;
  const u = await createUser({ name: label, email, password: 'password-123' });
  await markEmailVerified(u.id, email);
  return u;
}
const req = (ip: string) => ({ ip, socket: {} }) as unknown as Request;
const roleOf = async (boardId: string, userId: string) => (await getBoardAccess(boardId, userId)).role;
const fresh = async (id: string) => (await repo.getBoard(id))!;

it('a password-protected link lets in only people who gave the current password; a new password locks them out again, members never need it', async () => {
  const [owner, member, visitor] = [await person('Owner'), await person('Member'), await person('Visitor')];
  const board = await createBoard(owner.id, 'Plans', '', 'commenter');
  await inviteBoardMember(null, board.id, { ...owner, emailVerified: true } as never, { email: member.email, role: 'editor' });
  expect(await roleOf(board.id, visitor.id)).toBe('commenter');

  await changeLinkProtection(await fresh(board.id), owner.id, { linkPassword: 'first secret' });
  expect(await roleOf(board.id, visitor.id)).toBeNull();
  await expect(requireAccess(board.id, visitor.id)).rejects.toMatchObject({ status: 403, code: LINK_PASSWORD_REQUIRED });
  await expect(unlockLink(req('10.0.0.1'), await fresh(board.id), visitor.id, 'guess')).rejects.toMatchObject({ status: 403 });
  expect(await roleOf(board.id, visitor.id)).toBeNull();

  await unlockLink(req('10.0.0.1'), await fresh(board.id), visitor.id, 'first secret');
  expect(await roleOf(board.id, visitor.id)).toBe('commenter');

  await changeLinkProtection(await fresh(board.id), owner.id, { linkPassword: 'second secret' });
  expect(await roleOf(board.id, visitor.id)).toBeNull();
  expect(await roleOf(board.id, member.id)).toBe('editor');
  expect(await roleOf(board.id, owner.id)).toBe('owner');
});

it('wrong passwords run out: the right one is refused too once the attempts for that board are used up', async () => {
  const [owner, visitor] = [await person('Owner'), await person('Visitor')];
  const board = await createBoard(owner.id, 'Vault', '', 'viewer');
  await changeLinkProtection(await fresh(board.id), owner.id, { linkPassword: 'right one' });
  let refused = 0;
  for (let i = 0; i < 12; i++)
    await unlockLink(req(`10.1.0.${i}`), await fresh(board.id), visitor.id, `wrong ${i}`).catch((e: { status?: number }) => {
      if (e.status === 429) refused++;
    });
  expect(refused).toBeGreaterThan(0);
  await expect(unlockLink(req('10.1.1.1'), await fresh(board.id), visitor.id, 'right one')).rejects.toMatchObject({ status: 429 });
  expect(await roleOf(board.id, visitor.id)).toBeNull();
});

it('an expired link grants nothing to link visitors while members keep their access', async () => {
  const [owner, member, visitor] = [await person('Owner'), await person('Member'), await person('Visitor')];
  const board = await createBoard(owner.id, 'Sprint', '', 'editor');
  await inviteBoardMember(null, board.id, { ...owner, emailVerified: true } as never, { email: member.email, role: 'viewer' });
  await changeLinkProtection(await fresh(board.id), owner.id, { linkExpiresAt: Date.now() + 150 });
  expect(await roleOf(board.id, visitor.id)).toBe('editor');
  await new Promise((r) => setTimeout(r, 200));
  expect(await roleOf(board.id, visitor.id)).toBeNull();
  expect(await roleOf(board.id, member.id)).toBe('viewer');
  expect(await repo.expiredLinksToApply(Date.now(), 10)).toContain(board.id);
});
