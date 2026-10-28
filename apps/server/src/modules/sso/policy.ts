// Where sign-ins for an address go, and "Enforce SSO" (registered with auth's restriction seam).
import type { Request } from 'express';
import type { SsoDiscovery } from '@freero/shared';
import type { SignInAttempt, SignInRestriction } from '../auth/index';
import { getWorkspaceInfo, workspaceRole } from '../workspaces/index';
import { serviceProviderUrls, ssoMethod } from './connections';
import { domainOf } from './domains';
import * as repo from './repo';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Routing by domain only: whether an address's organization signs in through SSO. Never looks at accounts. */
export async function discover(req: Request, email: unknown, next: string): Promise<SsoDiscovery> {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(e)) return { sso: null };
  const c = await repo.connectionForDomain(domainOf(e));
  if (!c) return { sso: null };
  const ws = await getWorkspaceInfo(c.workspaceId);
  if (!ws) return { sso: null };
  const start = new URL(serviceProviderUrls(req, c.workspaceId).startUrl);
  start.searchParams.set('next', next);
  start.searchParams.set('login_hint', e);
  return { sso: { workspaceName: ws.name, startUrl: start.pathname + start.search, enforced: c.enforced } };
}

/**
 * auth's restriction check: an address at a verified domain whose workspace enforces SSO signs in
 * only through that workspace's identity provider — except the break-glass person, while they are
 * still an owner there.
 */
export async function enforcedSsoRestriction(a: SignInAttempt): Promise<SignInRestriction | null> {
  if (!EMAIL_RE.test(a.email)) return null;
  const c = await repo.connectionForDomain(domainOf(a.email));
  if (!c || !c.enforced) return null;
  if (a.method === ssoMethod(c.workspaceId)) return null;
  if (a.userId && a.userId === c.breakGlassUserId && (await workspaceRole(c.workspaceId, a.userId)) === 'owner') return null;
  const ws = await getWorkspaceInfo(c.workspaceId);
  return {
    message: `${ws?.name ?? 'Your organization'} requires single sign-on for ${domainOf(a.email)} addresses. Continue with SSO.`,
    ssoUrl: `/api/sso/${encodeURIComponent(c.workspaceId)}/start?login_hint=${encodeURIComponent(a.email)}`,
  };
}
