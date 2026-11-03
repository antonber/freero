import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { closeTestDb, mailIdle, openTestDb, outboxMails } from '../../platform/testing';
import { listAuditEvents } from '../audit/index';
import { createUser, markEmailVerified, onEmailVerified } from '../auth/index';
import { createTeamWorkspace, onTeamWorkspaceCreation, workspaceRole } from '../workspaces/index';
import { setTxtLookupForTests, txtName, txtValue } from './dns';
import { captureVerifiedAddress, completeDueCaptures, domainControlSettings, setDomainControl, startCaptures, teamWorkspaceCreationCheck } from './domainControl';
import { addDomain, removeDomain, verifyDomain } from './domains';
import * as repo from './repo';

const stops: Array<() => void> = [];
beforeAll(async () => {
  await openTestDb();
  // What sso/init.ts registers at startup.
  stops.push(onEmailVerified(captureVerifiedAddress), onTeamWorkspaceCreation(teamWorkspaceCreationCheck));
});
afterAll(async () => {
  for (const s of stops) s();
  await closeTestDb();
});

let n = 0;
const account = (email: string, verified = true): Promise<Account> =>
  createUser({ name: `Person ${++n}`, email, password: 'password-123' }, { emailVerified: verified });

/** A team workspace that verified `domain` through DNS. */
async function verifiedWorkspace(domain: string) {
  const owner = await account(`it-${++n}@${domain}`);
  const ws = await createTeamWorkspace(owner.id, `Org ${domain}`);
  await addDomain(ws.id, owner.id, domain);
  const claim = (await repo.listDomains(ws.id))[0];
  setTxtLookupForTests(async (name) => (name === txtName(domain) ? [txtValue(claim.token)] : []));
  await verifyDomain(ws.id, claim.id, owner.id);
  setTxtLookupForTests(null);
  return { ws, owner, domainId: claim.id };
}

it("a workspace that hasn't verified a domain can't list or capture accounts at it, and an account that only claims an address there (unverified) is never captured", async () => {
  const domain = `hijack-${Date.now()}.test`;
  const real = await verifiedWorkspace(domain);
  const victim = await account(`victim@${domain}`);
  const squatter = await account(`ceo@${domain}`, false);
  // A rival claims the same domain but can't prove it.
  const rivalOwner = await account(`rival-${Date.now()}@elsewhere.test`);
  const rival = await createTeamWorkspace(rivalOwner.id, 'Rival');
  await addDomain(rival.id, rivalOwner.id, domain);
  expect((await domainControlSettings(rival.id)).accounts).toEqual([]);
  expect(await startCaptures(rival.id, rivalOwner.id, { userIds: [victim.id], graceDays: 7 })).toBe(0);
  await expect(setDomainControl(rival.id, rivalOwner.id, { captureSignups: true })).rejects.toMatchObject({ status: 400 });

  const listed = (await domainControlSettings(real.ws.id)).accounts.map((a) => a.userId);
  expect(listed).toContain(victim.id);
  expect(listed).not.toContain(squatter.id);
  expect(await startCaptures(real.ws.id, real.owner.id, { userIds: [squatter.id], graceDays: 7 })).toBe(0);
  await completeDueCaptures(Date.now() + 365 * 86_400_000);
  expect(await workspaceRole(real.ws.id, squatter.id)).toBeNull();
  expect(await workspaceRole(rival.id, victim.id)).toBeNull();
});

it('an existing account at the verified domain is emailed and joins only when the grace period is over; a capture lapses when the workspace no longer holds the domain', async () => {
  const domain = `grace-${Date.now()}.test`;
  const { ws, owner, domainId } = await verifiedWorkspace(domain);
  const ann = await account(`ann@${domain}`);
  expect(await startCaptures(ws.id, owner.id, { userIds: [ann.id], graceDays: 14 })).toBe(1);
  await mailIdle();
  expect(outboxMails().some((m) => m.to === ann.email && /change your account’s email address before/.test(m.text))).toBe(true);
  expect((await domainControlSettings(ws.id)).accounts.find((a) => a.userId === ann.id)?.status).toBe('pending');

  await completeDueCaptures(Date.now() + 13 * 86_400_000);
  expect(await workspaceRole(ws.id, ann.id)).toBeNull();
  await completeDueCaptures(Date.now() + 15 * 86_400_000);
  expect(await workspaceRole(ws.id, ann.id)).toBe('member');
  const captured = await listAuditEvents({ workspaceId: ws.id, actions: ['sso.domain_account_captured'] }, 5);
  expect(captured.map((e) => e.targetId)).toEqual([ann.id]);

  // Domain given up before Bob's grace period ends: he never joins.
  const bob = await account(`bob@${domain}`);
  await startCaptures(ws.id, owner.id, { userIds: [bob.id], graceDays: 7 });
  await removeDomain(ws.id, owner.id, domainId);
  await completeDueCaptures(Date.now() + 8 * 86_400_000);
  expect(await workspaceRole(ws.id, bob.id)).toBeNull();
  expect(await repo.capturesOf(ws.id)).toEqual([]);
});

it('with "Add new sign-ups" on, an account joins the moment it proves an address at the domain (link or provider), not while the address is only claimed', async () => {
  const domain = `signup-${Date.now()}.test`;
  const { ws, owner } = await verifiedWorkspace(domain);
  await setDomainControl(ws.id, owner.id, { captureSignups: true });
  const claimed = await account(`new@${domain}`, false);
  expect(await workspaceRole(ws.id, claimed.id)).toBeNull();
  await markEmailVerified(claimed.id, claimed.email);
  expect(await workspaceRole(ws.id, claimed.id)).toBe('member');
  // Born verified (a provider vouched for the address).
  const vouched = await account(`google@${domain}`);
  expect(await workspaceRole(ws.id, vouched.id)).toBe('member');
});

it('with "Block other team workspaces" on, someone at the domain is refused a new team workspace with the admins named, and the refusal is audited; addresses elsewhere are unaffected', async () => {
  const domain = `block-${Date.now()}.test`;
  const { ws, owner } = await verifiedWorkspace(domain);
  const staff = await account(`staff@${domain}`);
  await setDomainControl(ws.id, owner.id, { blockWorkspaces: true });
  const refused = await createTeamWorkspace(staff.id, 'Shadow IT').catch((e: { status: number; message: string }) => e);
  expect(refused).toMatchObject({ status: 403 });
  expect((refused as { message: string }).message).toContain(owner.name);
  const audited = await listAuditEvents({ workspaceId: ws.id, actions: ['sso.workspace_creation_refused'] }, 5);
  expect(audited.map((e) => e.actorId)).toEqual([staff.id]);
  const outsider = await account(`someone-${Date.now()}@elsewhere.test`);
  await expect(createTeamWorkspace(outsider.id, 'Fine')).resolves.toMatchObject({ kind: 'team' });
});
