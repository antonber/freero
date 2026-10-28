import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import { createTeamWorkspace, inviteToWorkspace, setMemberDeactivated, updateWorkspace } from '../workspaces/index';
import { auditPage, csvField, requireAdmin } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@admin.test.freero.app`, password: 'password-123' }, { emailVerified: true });

async function team(owner: Account, people: Array<[Account, 'admin' | 'member' | 'guest']>) {
  const ws = await createTeamWorkspace(owner.id, `Team ${++n}`);
  for (const [u, role] of people) await inviteToWorkspace(null, ws.id, owner, { email: u.email, role });
  return ws.id;
}

it('only owners and admins of that very workspace reach its admin console', async () => {
  const [owner, admin, member, otherOwner] = await Promise.all(['Owner', 'Admin', 'Member', 'Other'].map(user));
  const ws = await team(owner, [
    [admin, 'admin'],
    [member, 'member'],
  ]);
  const other = await team(otherOwner, []);
  await expect(requireAdmin(ws, admin.id)).resolves.toBeTruthy();
  await expect(requireAdmin(ws, member.id)).rejects.toMatchObject({ status: 403 });
  await expect(requireAdmin(other, admin.id)).rejects.toMatchObject({ status: 404 });
});

it('a deactivated member opens nothing in the workspace — not even a board they own — until reactivated, and an admin can’t deactivate an owner', async () => {
  const [owner, admin, member] = await Promise.all(['Owner', 'Admin', 'Member'].map(user));
  const ws = await team(owner, [
    [admin, 'admin'],
    [member, 'member'],
  ]);
  const theirs = await createBoard(member.id, 'Their board', '', 'none', { workspaceId: ws });
  const shared = await createBoard(owner.id, 'Team board', '', 'none', { workspaceId: ws });

  await setMemberDeactivated(ws, admin.id, member.id, true);
  expect((await getBoardAccess(theirs.id, member.id)).role).toBeNull();
  expect((await getBoardAccess(shared.id, member.id)).role).toBeNull();
  await expect(createBoard(member.id, 'Sneaky', '', 'none', { workspaceId: ws })).rejects.toMatchObject({ status: 403 });
  // Everyone else keeps working with their content.
  expect((await getBoardAccess(theirs.id, owner.id)).role).toBe('editor');

  await setMemberDeactivated(ws, owner.id, member.id, false);
  expect((await getBoardAccess(theirs.id, member.id)).role).toBe('owner');
  await expect(setMemberDeactivated(ws, admin.id, owner.id, true)).rejects.toMatchObject({ status: 403 });
});

it('the workspace’s audit log shows who changed what (sharing policy, deactivation), newest first, and pages without gaps', async () => {
  const [owner, member] = await Promise.all(['Owner', 'Member'].map(user));
  const ws = await team(owner, [[member, 'member']]);
  await updateWorkspace(ws, owner.id, { policies: { downloads: 'admins' } });
  await setMemberDeactivated(ws, owner.id, member.id, true);

  const first = await auditPage({ workspaceId: ws }, 2);
  expect(first.events.map((e) => e.action)).toEqual(['member.deactivated', 'workspace.policies_changed']);
  expect(first.events[1]).toMatchObject({
    actor: { id: owner.id, name: 'Owner' },
    metadata: { 'downloads.from': 'anyone', 'downloads.to': 'admins' },
  });
  const rest = await auditPage({ workspaceId: ws, beforeId: first.next! }, 50);
  expect(rest.events.map((e) => e.action)).toEqual(['member.invited', 'workspace.created']);
  expect(rest.next).toBeNull();
});

it('an exported audit log never hands a spreadsheet a formula someone typed into a board title or name', () => {
  expect(csvField('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
  expect(csvField('+1 555')).toBe(`'+1 555`);
  expect(csvField('-2')).toBe(`'-2`);
  expect(csvField('@SUM(A1)')).toBe(`'@SUM(A1)`);
  expect(csvField('Roadmap, Q3')).toBe('"Roadmap, Q3"');
});
