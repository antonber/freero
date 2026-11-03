// Domain control (#64): what a team workspace does with Freero accounts at the domains it VERIFIED
// (DNS, domains.ts) — with or without single sign-on.
//
// - Accounts at the domain: admins see the accounts that PROVED an address there (verified; an
//   unverified claim to ceo@acme.com is anyone's, so it is never listed or taken in) and bring
//   existing ones in: each person is emailed, and after the grace period the `sso:domain-capture`
//   job makes them a member — only if the account still has that address, verified, and the
//   domain is still this workspace's. Changing their address before then is how someone whose
//   account isn't a work account opts out. Their own boards stay theirs: nothing is moved.
// - "Add new sign-ups": an account that verifies an address at the domain (sign-up, provider or
//   directory sign-in, email change: auth's onEmailVerified) joins at once, and is told.
// - "Block other team workspaces": people at the domain can't create team workspaces of their own
//   (workspaces' onTeamWorkspaceCreation); the refusal names the workspace's admins.
// Every capture, refusal and change is in the workspace's audit log. Only the ONE workspace that
// holds the domain verified can do any of this (sso_domains' partial unique index).
import { DOMAIN_CAPTURE_GRACE_DAYS, type DomainAccount, type DomainControlSettings } from '@freero/shared';
import { badRequest, HttpError } from '../../platform/http';
import { log, logError } from '../../platform/log';
import { appUrl, renderMail, sendMailLater } from '../../platform/mail';
import { formatWhen } from '../../platform/time';
import { recordAudit, recordAuditQuietly } from '../audit/index';
import { getAccount, getUsers, timeZonesOf, verifiedAccountsAtDomain } from '../auth/index';
import { applyDirectoryMembership, getWorkspaceInfo, workspaceAdminFacts, workspaceRole } from '../workspaces/index';
import { domainOf, verifiedDomainsOf } from './domains';
import * as repo from './repo';

const DAY = 86_400_000;
/** At most this many accounts are listed (and captured in one request). */
const MAX_ACCOUNTS = 2000;

const userTarget = (id: string, email: string) => ({ type: 'user', id, label: email });

/** What a captured account becomes part of: a team workspace, or an organisation's directory (#108). */
const joins = (ws: { kind: string } | null) => (ws?.kind === 'organisation' ? 'its organisation on Freero' : 'its team workspace');

async function joinRole(workspaceId: string): Promise<'admin' | 'member' | 'guest'> {
  return (await repo.getConnection(workspaceId))?.defaultRole ?? 'member';
}

export async function domainControlSettings(workspaceId: string): Promise<DomainControlSettings> {
  const [domains, policy, captures, facts] = await Promise.all([
    verifiedDomainsOf(workspaceId),
    repo.getDomainPolicy(workspaceId),
    repo.capturesOf(workspaceId),
    workspaceAdminFacts(workspaceId),
  ]);
  const members = new Set(facts.members.map((m) => m.userId));
  const pending = new Map(captures.map((c) => [c.userId, c]));
  const accounts: DomainAccount[] = [];
  for (const domain of domains)
    for (const a of await verifiedAccountsAtDomain(domain, MAX_ACCOUNTS)) {
      const c = pending.get(a.id);
      accounts.push({
        userId: a.id,
        name: a.name,
        email: a.email,
        status: members.has(a.id) ? 'member' : c && c.email === a.email ? 'pending' : 'outside',
        joinsAt: !members.has(a.id) && c && c.email === a.email ? c.joinsAt : null,
      });
    }
  return { domains, ...policy, accounts: accounts.slice(0, MAX_ACCOUNTS) };
}

export async function setDomainControl(workspaceId: string, actorId: string, body: { captureSignups?: unknown; blockWorkspaces?: unknown }): Promise<void> {
  const prev = await repo.getDomainPolicy(workspaceId);
  const flag = (v: unknown, name: string, was: boolean) => {
    if (v === undefined) return was;
    if (typeof v !== 'boolean') throw badRequest(`${name} must be true or false`);
    return v;
  };
  const next = { captureSignups: flag(body.captureSignups, 'captureSignups', prev.captureSignups), blockWorkspaces: flag(body.blockWorkspaces, 'blockWorkspaces', prev.blockWorkspaces) };
  if ((next.captureSignups || next.blockWorkspaces) && !(await verifiedDomainsOf(workspaceId)).length) throw badRequest('Verify a domain first');
  await repo.transaction(async () => {
    await repo.saveDomainPolicy(workspaceId, next, Date.now());
    await recordAudit({ action: 'sso.domain_control_changed', workspaceId, actorId, target: { type: 'sso', id: workspaceId }, metadata: { ...next } });
  });
}

/**
 * Starts bringing existing accounts at the verified domains in: each is emailed and joins after
 * `graceDays`. Ids that aren't verified accounts at one of THIS workspace's verified domains, or
 * that are members or pending already, are skipped. Returns how many were started.
 */
export async function startCaptures(workspaceId: string, actorId: string, body: { userIds?: unknown; graceDays?: unknown }): Promise<number> {
  const ids = Array.isArray(body.userIds) ? [...new Set(body.userIds.filter((v): v is string => typeof v === 'string'))] : null;
  if (!ids || !ids.length) throw badRequest('userIds must list the people to add');
  if (ids.length > MAX_ACCOUNTS) throw badRequest(`At most ${MAX_ACCOUNTS} people at a time`);
  const graceDays = body.graceDays ?? 14;
  if (!(DOMAIN_CAPTURE_GRACE_DAYS as readonly unknown[]).includes(graceDays)) throw badRequest(`graceDays must be ${DOMAIN_CAPTURE_GRACE_DAYS.join(', ')}`);
  const settings = await domainControlSettings(workspaceId);
  const eligible = new Map(settings.accounts.filter((a) => a.status === 'outside').map((a) => [a.userId, a]));
  const chosen = ids.map((id) => eligible.get(id)).filter((a): a is DomainAccount => !!a);
  if (!chosen.length) return 0;
  const now = Date.now();
  const joinsAt = now + (graceDays as number) * DAY;
  const started: DomainAccount[] = [];
  await repo.transaction(async () => {
    for (const a of chosen) {
      // A capture made for an address the account no longer has is void: this one replaces it.
      await repo.takeCapture(workspaceId, a.userId);
      if (!(await repo.insertCapture({ workspaceId, userId: a.userId, email: a.email, joinsAt, startedBy: actorId }, now))) continue;
      await recordAudit({ action: 'sso.domain_capture_started', workspaceId, actorId, target: userTarget(a.userId, a.email), metadata: { domain: domainOf(a.email), joinsAt, graceDays: graceDays as number } });
      started.push(a);
    }
  });
  const ws = await getWorkspaceInfo(workspaceId);
  const zones = await timeZonesOf(started.map((a) => a.userId));
  for (const a of started) {
    const date = formatWhen(joinsAt, zones.get(a.userId));
    sendMailLater({
      to: a.email,
      ...renderMail({
        subject: `Your Freero account is joining ${ws?.name ?? 'your organization'}’s workspace`,
        title: `${ws?.name ?? 'Your organization'} manages ${domainOf(a.email)} accounts`,
        paragraphs: [
          `${ws?.name ?? 'Your organization'} verified that it owns ${domainOf(a.email)}, the domain of your Freero account ${a.email}. On ${date}, your account becomes a member of ${joins(ws)}.`,
          'Your own boards stay yours: nothing moves into the workspace unless you move it.',
          `If this isn’t a work account, change your account’s email address before ${date} and it won’t join.`,
        ],
        action: { label: 'Open your account settings', url: appUrl(null, '/settings') },
      }),
    });
  }
  return started.length;
}

export async function cancelCapture(workspaceId: string, actorId: string, userId: string): Promise<void> {
  await repo.transaction(async () => {
    const c = await repo.takeCapture(workspaceId, userId);
    if (!c) throw new HttpError(404, 'Nobody is waiting to join with that account');
    await recordAudit({ action: 'sso.domain_capture_cancelled', workspaceId, actorId, target: userTarget(c.userId, c.email), metadata: { reason: 'cancelled' } });
  });
}

/**
 * Whether the capture still applies: the account still has the captured address, verified, and
 * the workspace still holds its domain verified. Returns why not, or null.
 */
async function voidReason(c: repo.CaptureRecord): Promise<string | null> {
  const account = await getAccount(c.userId).catch(() => null);
  if (!account) return 'account gone';
  if (account.email !== c.email || !account.emailVerified) return 'address changed';
  if (account.deletionScheduledFor !== null) return 'account being deleted';
  if ((await repo.domainOwner(domainOf(c.email)))?.workspaceId !== c.workspaceId) return 'domain no longer verified by this workspace';
  return null;
}

/** The grace periods that are over: those people join (or their capture lapses). Idempotent. */
export async function completeDueCaptures(now = Date.now()): Promise<number> {
  let joined = 0;
  for (const c of await repo.dueCaptures(now, 200)) {
    try {
      const why = await voidReason(c);
      if (why) {
        if (await repo.takeCapture(c.workspaceId, c.userId))
          await recordAuditQuietly({ action: 'sso.domain_capture_cancelled', workspaceId: c.workspaceId, actorId: null, target: userTarget(c.userId, c.email), metadata: { reason: why } });
        continue;
      }
      const role = await joinRole(c.workspaceId);
      let added = false;
      await applyDirectoryMembership(c.workspaceId, c.userId, role, {
        overwrite: false,
        onJoined: async (r) => {
          added = true;
          await recordAudit({ action: 'sso.domain_account_captured', workspaceId: c.workspaceId, actorId: null, target: userTarget(c.userId, c.email), metadata: { role: r, via: 'grace_period', startedBy: c.startedBy } });
        },
      });
      await repo.takeCapture(c.workspaceId, c.userId);
      if (added) joined++;
    } catch (e) {
      logError(`sso: could not complete the domain capture of ${c.userId} into ${c.workspaceId}`, e);
    }
  }
  if (joined) log(`sso: ${joined} account(s) at verified domains joined their workspace`);
  return joined;
}

/**
 * auth's onEmailVerified: someone proved an address at a verified domain whose workspace adds new
 * sign-ups — they join it now, and are told.
 */
export async function captureVerifiedAddress(user: { id: string; email: string }): Promise<void> {
  const owner = await repo.domainOwner(domainOf(user.email));
  if (!owner?.captureSignups) return;
  const ws = await getWorkspaceInfo(owner.workspaceId);
  if (!ws || ws.kind === 'personal') return;
  if ((await workspaceRole(ws.id, user.id)) !== null) return;
  let added = false;
  await applyDirectoryMembership(ws.id, user.id, await joinRole(ws.id), {
    overwrite: false,
    onJoined: async (role) => {
      added = true;
      await recordAudit({ action: 'sso.domain_account_captured', workspaceId: ws.id, actorId: null, target: userTarget(user.id, user.email), metadata: { role, via: 'verified_address' } });
    },
  });
  await repo.takeCapture(ws.id, user.id);
  if (!added) return;
  sendMailLater({
    to: user.email,
    ...renderMail({
      subject: `You’re now in ${ws.name}’s Freero workspace`,
      title: `${ws.name} manages ${domainOf(user.email)} accounts`,
      paragraphs: [
        `${ws.name} verified that it owns ${domainOf(user.email)}, so your Freero account ${user.email} is now a member of ${joins(ws)}.`,
        'Your own boards stay yours: nothing moves into the workspace unless you move it.',
      ],
      action: { label: 'Open the workspace', url: appUrl(null, `/app?ws=${encodeURIComponent(ws.id)}`) },
    }),
  });
}

/** An address that would join a workspace on verifying it ("Add new sign-ups" at its domain). */
export async function joinsOnSignup(email: string): Promise<boolean> {
  return (await repo.domainOwner(domainOf(email)))?.captureSignups ?? false;
}

/**
 * workspaces' creation check: with "Block other team workspaces", someone at the domain may not
 * create a team workspace (verified address or not: refusing is the safe side). Recorded in the
 * managing workspace's log; the message names its admins.
 */
export async function teamWorkspaceCreationCheck(userId: string, name: string): Promise<string | null> {
  const account = await getAccount(userId).catch(() => null);
  if (!account) return null;
  const domain = domainOf(account.email);
  const owner = await repo.domainOwner(domain);
  if (!owner?.blockWorkspaces) return null;
  const [ws, facts] = await Promise.all([getWorkspaceInfo(owner.workspaceId), workspaceAdminFacts(owner.workspaceId)]);
  const adminIds = facts.members.filter((m) => !m.deactivated && (m.role === 'owner' || m.role === 'admin')).map((m) => m.userId);
  const users = await getUsers(adminIds.slice(0, 5));
  const names = adminIds.slice(0, 5).map((id) => users.get(id)?.name).filter(Boolean);
  await recordAuditQuietly({ action: 'sso.workspace_creation_refused', workspaceId: owner.workspaceId, actorId: userId, target: userTarget(userId, account.email), metadata: { name: name.slice(0, 200) } });
  const who = names.length ? ` Ask its admins (${names.join(', ')}${adminIds.length > names.length ? ' and others' : ''})` : ' Ask its admins';
  return `${ws?.name ?? 'Your organization'} manages ${domain} accounts, so you can’t create a team workspace of your own.${who} to add you, or work in ${ws?.name ?? 'its workspace'}.`;
}
