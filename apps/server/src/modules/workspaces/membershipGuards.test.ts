// Membership changes are authorised under the workspace's lock, a workspace always keeps an active
// owner, and an invite works only while the person who sent it could still send it.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { mailIdle, onOutboxMail } from '../../platform/mail';
import { workspaceEventsAfter } from '../audit/index';
import { createUser } from '../auth/index';
import { acceptInvite, inviteToWorkspace, resendInvite } from './invites';
import * as repo from './repo';
import { changeRole, createTeamWorkspace, removeMember, setMemberDeactivated, transferWorkspace } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@guards.test.freero.app`, password: 'password-123' }, { emailVerified: true });

/** A team whose people are all owners (the first created it). */
async function teamOfOwners(owners: Account[]) {
  const ws = await createTeamWorkspace(owners[0].id, `Team ${++n}`);
  for (const o of owners.slice(1)) {
    await inviteToWorkspace(null, ws.id, owners[0], { email: o.email, role: 'admin' });
    await changeRole(ws.id, owners[0].id, o.id, 'owner');
  }
  return ws.id;
}

const activeOwners = async (ws: string) => (await repo.listMembers(ws)).filter((m) => m.role === 'owner' && m.deactivatedAt === null);

/** Runs `send` and returns the link token of the workspace invite it mailed. */
async function mailedToken(send: () => Promise<unknown>): Promise<string> {
  let token: string | null = null;
  const off = onOutboxMail((m) => (token ??= /\/workspace-invite\/([A-Za-z0-9_-]+)/.exec(m.text)?.[1] ?? null));
  try {
    await send();
    await mailIdle();
  } finally {
    off();
  }
  expect(token).not.toBeNull();
  return token!;
}

it('a workspace keeps an active owner when its two owners deactivate each other at the same moment', async () => {
  const [a, b] = await Promise.all([user('OwnerA'), user('OwnerB')]);
  const ws = await teamOfOwners([a, b]);
  await Promise.allSettled([setMemberDeactivated(ws, a.id, b.id, true), setMemberDeactivated(ws, b.id, a.id, true)]);
  expect(await activeOwners(ws)).toHaveLength(1);
});

it('an owner demoted a moment ago can no longer demote the other owners', async () => {
  const [a, b, c] = await Promise.all([user('OwnerA'), user('OwnerB'), user('OwnerC')]);
  const ws = await teamOfOwners([a, b, c]);
  // A demotes B while B (still an owner when its request arrived) demotes C.
  await Promise.allSettled([changeRole(ws, a.id, b.id, 'admin'), changeRole(ws, b.id, c.id, 'admin')]);
  // The role changes that landed, in the order they were committed (the workspace's audit chain).
  const changes = (await workspaceEventsAfter(ws, 0, 1000)).filter((e) => e.action === 'member.role_changed' && e.metadata.to === 'admin');
  const bDemotedAt = changes.findIndex((e) => e.targetId === b.id);
  const bActedAt = changes.findIndex((e) => e.actorId === b.id);
  // B must not have changed anyone's role after it stopped being an owner.
  expect(bActedAt === -1 || bDemotedAt === -1 || bActedAt < bDemotedAt).toBe(true);
});

it('handing a workspace over to a deactivated member is refused, so it keeps an owner who can act', async () => {
  const [owner, sleeper] = await Promise.all([user('Owner'), user('Sleeper')]);
  const ws = await createTeamWorkspace(owner.id, `Team ${++n}`);
  await inviteToWorkspace(null, ws.id, owner, { email: sleeper.email, role: 'member' });
  await setMemberDeactivated(ws.id, owner.id, sleeper.id, true);
  await expect(transferWorkspace(ws.id, owner.id, sleeper.id)).rejects.toMatchObject({ status: 400 });
  expect((await activeOwners(ws.id)).map((m) => m.userId)).toEqual([owner.id]);
});

it('the last owner of a workspace left with only deactivated owners (before that was refused) can’t leave it ownerless: 409, not a crash', async () => {
  const [a, b] = await Promise.all([user('OwnerA'), user('OwnerB')]);
  const ws = await teamOfOwners([a, b]);
  // The state an older server could reach: every owner deactivated.
  await repo.setDeactivated(ws, a.id, Date.now());
  await repo.setDeactivated(ws, b.id, Date.now());
  await removeMember(ws, b.id, b.id); // another owner is still there to inherit
  await expect(removeMember(ws, a.id, a.id)).rejects.toMatchObject({ status: 409 });
  expect((await repo.listMembers(ws)).map((m) => m.userId)).toEqual([a.id]);
});

it('the invitations an admin sent stop working once that admin is removed from the workspace', async () => {
  const [owner, admin] = await Promise.all([user('Owner'), user('Admin')]);
  const ws = await createTeamWorkspace(owner.id, `Team ${++n}`);
  await inviteToWorkspace(null, ws.id, owner, { email: admin.email, role: 'admin' });
  // The admin invites an address of their own (no account yet) as a member…
  const token = await mailedToken(() => inviteToWorkspace(null, ws.id, admin, { email: `alt-${n}@elsewhere.test`, role: 'member' }));
  // …and is then removed by the owner. The invite they sent must not let anyone in afterwards.
  await removeMember(ws.id, owner.id, admin.id);
  const alt = await user('Alt');
  await expect(acceptInvite(token, alt)).rejects.toMatchObject({ status: 404 });
  expect(await repo.getMember(ws.id, alt.id)).toBeNull();
});

it('an admin invitation an owner sent stops working once that owner is demoted to admin', async () => {
  const [a, b] = await Promise.all([user('OwnerA'), user('OwnerB')]);
  const ws = await teamOfOwners([a, b]);
  const token = await mailedToken(() => inviteToWorkspace(null, ws, b, { email: `new-admin-${n}@elsewhere.test`, role: 'admin' }));
  await changeRole(ws, a.id, b.id, 'admin'); // admins can't add admins
  const invitee = await user('Invitee');
  await expect(acceptInvite(token, invitee)).rejects.toMatchObject({ status: 404 });
});

it('an invite a removed admin sent works again once a current admin resends it in their own name', async () => {
  const [owner, gone, admin] = await Promise.all([user('Owner'), user('Gone'), user('Admin')]);
  const ws = await createTeamWorkspace(owner.id, `Team ${++n}`);
  for (const u of [gone, admin]) await inviteToWorkspace(null, ws.id, owner, { email: u.email, role: 'admin' });
  const sent = await inviteToWorkspace(null, ws.id, gone, { email: `pending-${n}@elsewhere.test`, role: 'member' });
  await removeMember(ws.id, owner.id, gone.id);
  const token = await mailedToken(() => resendInvite(null, ws.id, (sent as { invite: { id: string } }).invite.id, admin));
  const invitee = await user('Invitee');
  await acceptInvite(token, invitee);
  expect((await repo.getMember(ws.id, invitee.id))?.role).toBe('member');
});
