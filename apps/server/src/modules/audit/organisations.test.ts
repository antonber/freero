// #108: an attached workspace's events stay in its own hash chain AND reach its organisation's,
// each chain verifying on its own; detaching stops the copies.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { attachWorkspace, createOrganisation, createTeamWorkspace, detachWorkspace, updateWorkspace } from '../workspaces/index';
import { listAuditEvents, verifyWorkspaceAudit } from './service';
import { connectAudit } from './wiring';

let disconnect = () => {};
beforeAll(async () => {
  await openTestDb();
  disconnect = connectAudit();
});
afterAll(async () => {
  disconnect();
  await closeTestDb();
});

const log = async (workspaceId: string) => (await listAuditEvents({ workspaceId }, 100)).map((e) => ({ action: e.action, workspaceId: e.workspaceId, chain: e.chain }));

it('an attached workspace’s events land in its own log once and in its organisation’s log too, both chains verify on their own, and detaching stops the copies', async () => {
  const owner = await createUser({ name: 'Owner', email: `owner-${Date.now()}@audit-org.test`, password: 'password-123' }, { emailVerified: true });
  const [a, b] = [await createTeamWorkspace(owner.id, 'Design'), await createTeamWorkspace(owner.id, 'Sales')];
  const org = await createOrganisation(owner.id, 'Group');
  await attachWorkspace(org.id, a.id, owner.id);
  await attachWorkspace(org.id, b.id, owner.id);
  await updateWorkspace(a.id, owner.id, { name: 'Design team' });
  await updateWorkspace(b.id, owner.id, { policies: { downloads: 'members' } });

  const own = await log(a.id);
  expect(own.filter((e) => e.action === 'workspace.renamed')).toEqual([{ action: 'workspace.renamed', workspaceId: a.id, chain: `w:${a.id}` }]);
  expect(own.some((e) => e.action === 'organisation.created' || e.action === 'workspace.policies_changed')).toBe(false);
  const merged = await log(org.id);
  expect(merged).toEqual(
    expect.arrayContaining([
      { action: 'workspace.renamed', workspaceId: a.id, chain: `w:${org.id}` },
      { action: 'workspace.policies_changed', workspaceId: b.id, chain: `w:${org.id}` },
      { action: 'organisation.workspace_attached', workspaceId: a.id, chain: `w:${org.id}` },
      { action: 'organisation.created', workspaceId: org.id, chain: `w:${org.id}` },
    ]),
  );
  for (const id of [a.id, b.id, org.id]) expect((await verifyWorkspaceAudit(id)).ok).toBe(true);

  await detachWorkspace(org.id, a.id, owner.id);
  await updateWorkspace(a.id, owner.id, { name: 'Design again' });
  const after = await log(org.id);
  expect(after.filter((e) => e.action === 'organisation.workspace_detached')).toEqual([{ action: 'organisation.workspace_detached', workspaceId: a.id, chain: `w:${org.id}` }]);
  expect(after.filter((e) => e.action === 'workspace.renamed')).toHaveLength(1);
  expect((await log(a.id)).filter((e) => e.action === 'organisation.workspace_detached')).toHaveLength(1);
  for (const id of [a.id, org.id]) expect((await verifyWorkspaceAudit(id)).ok).toBe(true);
});
