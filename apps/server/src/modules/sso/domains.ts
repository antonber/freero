// Domains a team workspace claims for single sign-on, proved by a DNS TXT record. Only a verified
// domain counts: it routes sign-ins to the workspace's identity provider, lets that provider vouch
// for addresses at it (accounts made just in time, SCIM provisioning) and is what "Enforce SSO"
// applies to. One workspace at most holds a domain verified (first to prove it); a claim never
// verifies through anything but a matching TXT answer.
import { randomBytes } from 'node:crypto';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { recordAudit } from '../audit/index';
import { domainHasToken } from './dns';
import * as repo from './repo';

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const MAX_DOMAINS = 20;

export function cleanDomain(v: unknown): string {
  const d = typeof v === 'string' ? v.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '') : '';
  if (!DOMAIN_RE.test(d)) throw badRequest('Enter a domain like example.com');
  return d;
}

export const domainOf = (email: string): string => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

const domainTarget = (id: string, domain: string) => ({ type: 'domain', id, label: domain });

export async function addDomain(workspaceId: string, actorId: string, input: unknown): Promise<void> {
  const domain = cleanDomain(input);
  if ((await repo.listDomains(workspaceId)).length >= MAX_DOMAINS) throw badRequest(`A workspace can claim at most ${MAX_DOMAINS} domains`);
  const id = newId(12);
  await repo.transaction(async () => {
    if (!(await repo.insertDomain({ id, workspaceId, domain, token: randomBytes(16).toString('hex'), now: Date.now() })))
      throw new HttpError(409, `${domain} is already on the list`);
    await recordAudit({ action: 'sso.domain_added', workspaceId, actorId, target: domainTarget(id, domain) });
  });
}

/** Looks the TXT record up now; verified on a match. 409 with a reason otherwise. */
export async function verifyDomain(workspaceId: string, domainId: string, actorId: string): Promise<void> {
  const d = await repo.getDomain(workspaceId, domainId);
  if (!d) throw notFound('Domain not found');
  if (d.verifiedAt !== null) return;
  const now = Date.now();
  let found: boolean;
  try {
    found = await domainHasToken(d.domain, d.token);
  } catch (e) {
    await repo.markDomainChecked(d.id, now);
    throw new HttpError(409, `Couldn’t look up ${d.domain}’s DNS right now (${(e as { code?: string }).code ?? 'error'}). Try again in a minute.`);
  }
  if (!found) {
    await repo.markDomainChecked(d.id, now);
    throw new HttpError(409, `The TXT record isn’t visible yet. DNS changes can take a while to spread; try again later.`);
  }
  try {
    await repo.transaction(async () => {
      await repo.markDomainVerified(d.id, now);
      await recordAudit({ action: 'sso.domain_verified', workspaceId, actorId, target: domainTarget(d.id, d.domain) });
    });
  } catch (e) {
    if (e instanceof repo.DomainTakenError) throw new HttpError(409, `${d.domain} is already verified by another workspace`);
    throw e;
  }
}

export async function removeDomain(workspaceId: string, actorId: string, domainId: string): Promise<void> {
  const d = await repo.getDomain(workspaceId, domainId);
  if (!d) throw notFound('Domain not found');
  await repo.transaction(async () => {
    if (!(await repo.deleteDomain(workspaceId, domainId))) throw notFound('Domain not found');
    await recordAudit({ action: 'sso.domain_removed', workspaceId, actorId, target: domainTarget(d.id, d.domain), metadata: { wasVerified: d.verifiedAt !== null } });
  });
}

/** The workspace's verified domains. */
export async function verifiedDomainsOf(workspaceId: string): Promise<string[]> {
  return (await repo.listDomains(workspaceId)).filter((d) => d.verifiedAt !== null).map((d) => d.domain);
}

/** Whether the address is at a domain the workspace verified (the organization's own address). */
export async function isOrganizationEmail(workspaceId: string, email: string): Promise<boolean> {
  return (await repo.verifiedDomain(domainOf(email)))?.workspaceId === workspaceId;
}
