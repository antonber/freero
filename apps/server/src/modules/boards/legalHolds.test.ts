// Legal holds (#157): while an eDiscovery case keeps a board, no way of deleting it deletes it — not
// the trash purge, not its owner's "delete forever", not the account purge, not workspace deletion,
// not even a statement that bypasses the service — and a custodian's board stays held when it changes
// hands. Releasing the case lets normal retention resume.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { purgeDueAccounts } from '../accounts/index';
import { createUser, getUser, scheduleAccountDeletion } from '../auth/index';
import { changeCase, createCase, getCaseDetail, releaseCase } from '../ediscovery/index';
import { changeWorkspaceRole, createTeamWorkspace, deleteWorkspace, inviteToWorkspace } from '../workspaces/index';
import { boardRecords } from './index';
import * as repo from './repo';
import { createBoard, deleteForever, listBoards, moveToTrash, purgeExpiredTrashLocked, transferBoard } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

const DAY = 86_400_000;
let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@holds.test.freero.app`, password: 'password-123' }, { emailVerified: true });

async function team(owner: Account, members: Account[], admins: Array<[Account, Array<'members' | 'content' | 'security'>]> = []) {
  const ws = await createTeamWorkspace(owner.id, `Legal ${++n}`);
  for (const m of members) await inviteToWorkspace(null, ws.id, owner, { email: m.email, role: 'member' });
  for (const [a, scopes] of admins) {
    await inviteToWorkspace(null, ws.id, owner, { email: a.email, role: 'admin' });
    await changeWorkspaceRole(ws.id, owner.id, a.id, 'admin', scopes);
  }
  return ws;
}
const exists = async (id: string) => (await boardRecords([id])).length === 1;

it('no path deletes a held board: the trash purge, its owner’s delete forever, the account purge and workspace deletion all keep it; release lets the purge take it', async () => {
  const owner = await user('Owner');
  const custodian = await user('Custodian');
  const other = await user('Other');
  const ws = await team(owner, [custodian, other]);
  const evidence = await createBoard(custodian.id, 'Q3 pricing', '', 'none', { workspaceId: ws.id });
  const named = await createBoard(other.id, 'Supplier notes', '', 'none', { workspaceId: ws.id });
  const free = await createBoard(other.id, 'Lunch menu', '', 'none', { workspaceId: ws.id });
  const c = await createCase(ws.id, owner.id, { name: 'Acme v. Us', custodianIds: [custodian.id], boardIds: [named.id] });
  // A board the custodian makes after the hold is held too.
  const later = await createBoard(custodian.id, 'Made after the hold', '', 'none', { workspaceId: ws.id });
  expect((await getCaseDetail(ws.id, c.id, owner.id)).boards.map((b) => b.id).sort()).toEqual([evidence.id, named.id, later.id].sort());

  const longAgo = Date.now() - 400 * DAY;
  for (const b of [evidence, named, free, later]) await moveToTrash(b, b.ownerId, longAgo);
  // Its owner deletes it forever: it looks gone to them, it is kept.
  await deleteForever(later.id, custodian.id);
  expect((await listBoards(custodian.id, 'trash', '', { workspaceId: ws.id })).map((b) => b.id)).toEqual([evidence.id]);
  await purgeExpiredTrashLocked();
  expect(await exists(free.id)).toBe(false);
  for (const b of [evidence, named, later]) expect(await exists(b.id)).toBe(true);
  // Past its retention a held board leaves the trash as if purged (the hold stays silent).
  expect(await listBoards(custodian.id, 'trash', '', { workspaceId: ws.id })).toEqual([]);

  // Workspace deletion is refused; the account purge waits.
  await expect(deleteWorkspace(null, ws.id, owner.id, (await getCaseDetail(ws.id, c.id, owner.id)).workspaces[0].name)).rejects.toMatchObject({ status: 409, code: 'legal_hold' });
  await scheduleAccountDeletion(null, custodian.id, 'password-123');
  const afterGrace = Date.now() + getConfig().accountDeletionGraceMs + 60_000;
  await purgeDueAccounts(afterGrace);
  expect(await getUser(custodian.id)).not.toBeNull();
  expect(await exists(evidence.id)).toBe(true);

  // A statement that skips every service check is refused by the database itself.
  await expect(repo.deleteAllInWorkspace(ws.id)).rejects.toMatchObject({ code: repo.LEGAL_HOLD_ERROR });
  expect(await exists(named.id)).toBe(true);

  await releaseCase(ws.id, c.id, owner.id);
  await purgeExpiredTrashLocked();
  for (const b of [evidence, named, later]) expect(await exists(b.id)).toBe(false);
  await purgeDueAccounts(afterGrace);
  expect(await getUser(custodian.id)).toBeNull();
});

it('a custodian’s board stays held after it is handed to someone else, and leaves the hold only with its custodian', async () => {
  const owner = await user('Owner');
  const custodian = await user('Custodian');
  const heir = await user('Heir');
  const ws = await team(owner, [custodian, heir]);
  const board = await createBoard(custodian.id, 'Handed over', '', 'none', { workspaceId: ws.id });
  const c = await createCase(ws.id, owner.id, { name: 'Hand-over', custodianIds: [custodian.id] });
  const moved = await transferBoard(board, custodian.id, heir.id);
  expect(moved.ownerId).toBe(heir.id);
  expect((await repo.heldAmong([board.id])).has(board.id)).toBe(true); // not the heir's custodianship: the board's own row

  await changeCase(ws.id, c.id, owner.id, { removeCustodianIds: [custodian.id] });
  expect((await repo.heldAmong([board.id])).has(board.id)).toBe(false);
});

it('only owners and admins with both the security and content scopes see, change, export or release a case', async () => {
  const owner = await user('Owner');
  const security = await user('SecurityAdmin');
  const content = await user('ContentAdmin');
  const both = await user('LegalAdmin');
  const member = await user('Member');
  const ws = await team(owner, [member], [
    [security, ['security']],
    [content, ['content']],
    [both, ['security', 'content']],
  ]);
  const c = await createCase(ws.id, both.id, { name: 'Investigation', custodianIds: [member.id] });
  for (const u of [security, content, member]) {
    await expect(getCaseDetail(ws.id, c.id, u.id)).rejects.toMatchObject({ status: 403 });
    await expect(releaseCase(ws.id, c.id, u.id)).rejects.toMatchObject({ status: 403 });
    await expect(createCase(ws.id, u.id, { name: 'Mine', custodianIds: [owner.id] })).rejects.toMatchObject({ status: 403 });
  }
  expect((await getCaseDetail(ws.id, c.id, owner.id)).custodians.map((p) => p.userId)).toEqual([member.id]);
});

it('a case can’t reach a board or a person outside the workspaces it covers', async () => {
  const owner = await user('Owner');
  const outsider = await user('Outsider');
  const ws = await team(owner, []);
  const elsewhere = await createTeamWorkspace(outsider.id, `Elsewhere ${++n}`);
  const theirs = await createBoard(outsider.id, 'Not yours', '', 'none', { workspaceId: elsewhere.id });
  await expect(createCase(ws.id, owner.id, { name: 'Overreach', boardIds: [theirs.id] })).rejects.toMatchObject({ status: 400 });
  await expect(createCase(ws.id, owner.id, { name: 'Overreach', custodianIds: [outsider.id] })).rejects.toMatchObject({ status: 400 });
  expect((await repo.heldAmong([theirs.id])).size).toBe(0);
});
