// A team workspace's identity provider: its settings (owners/admins), and "Enforce SSO".
import type { Request } from 'express';
import type { SsoConnectionInput, SsoSettings, WorkspaceRole } from '@freero/shared';
import { badRequest, HttpError } from '../../platform/http';
import { log } from '../../platform/log';
import { appUrl } from '../../platform/mail';
import { seal } from '../../platform/secrets';
import { endSessionsOf, userIdsAtDomain } from '../auth/index';
import { workspaceRole } from '../workspaces/index';
import { txtName, txtValue } from './dns';
import { verifiedDomainsOf } from './domains';
import * as repo from './repo';
import { certificateInfo, checkHttpsUrl, normalizeCertificate, parseIdpMetadata, splitCertificates } from './saml';

/** The HKDF purpose sealing OIDC client secrets at rest (platform/secrets). */
export const CLIENT_SECRET_PURPOSE = 'sso-oidc-client-secret-v1';

const DIRECTORY_ROLES = ['admin', 'member', 'guest'] as const;

/** URLs of this workspace's service provider (what its identity provider is configured with). */
export function serviceProviderUrls(req: Request | null, workspaceId: string) {
  const base = appUrl(req, `/api/sso/${encodeURIComponent(workspaceId)}`);
  return {
    entityId: `${base}/saml/metadata`,
    metadataUrl: `${base}/saml/metadata`,
    acsUrl: `${base}/saml/acs`,
    oidcRedirectUri: `${base}/oidc/callback`,
    startUrl: `${base}/start`,
  };
}

/** The sign-in method (session, identity provider id) of a workspace's single sign-on. */
export const ssoMethod = (workspaceId: string) => `sso:${workspaceId}`;

export async function ssoSettings(req: Request | null, workspaceId: string): Promise<SsoSettings> {
  const [domains, c] = await Promise.all([repo.listDomains(workspaceId), repo.getConnection(workspaceId)]);
  return {
    domains: domains.map((d) => ({
      id: d.id,
      domain: d.domain,
      verified: d.verifiedAt !== null,
      txtName: txtName(d.domain),
      txtValue: txtValue(d.token),
      lastCheckedAt: d.lastCheckedAt,
    })),
    connection: c && {
      protocol: c.protocol,
      enabled: c.enabled,
      enforced: c.enforced,
      breakGlassUserId: c.breakGlassUserId,
      defaultRole: c.defaultRole,
      sessionHours: c.sessionHours,
      saml:
        c.protocol === 'saml' && c.samlEntityId && c.samlSsoUrl
          ? { entityId: c.samlEntityId, ssoUrl: c.samlSsoUrl, certificates: splitCertificates(c.samlCerts).map(certificateInfo) }
          : null,
      oidc: c.protocol === 'oidc' && c.oidcIssuer && c.oidcClientId ? { issuer: c.oidcIssuer, clientId: c.oidcClientId, hasClientSecret: !!c.oidcClientSecret } : null,
      testedAt: c.testedAt,
    },
    serviceProvider: serviceProviderUrls(req, workspaceId),
  };
}

const str = (v: unknown, what: string, max = 2048): string => {
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${what} is required`);
  if (v.length > max) throw badRequest(`${what} is too long`);
  return v.trim();
};

/** Saves the identity provider. Pointing it at another provider turns enforcement off until a sign-in proves it. */
export async function saveConnection(workspaceId: string, body: Partial<SsoConnectionInput>): Promise<void> {
  const protocol = body.protocol;
  if (protocol !== 'saml' && protocol !== 'oidc') throw badRequest('protocol must be saml or oidc');
  const prev = await repo.getConnection(workspaceId);
  const defaultRole = body.defaultRole ?? prev?.defaultRole ?? 'member';
  if (!(DIRECTORY_ROLES as readonly string[]).includes(defaultRole)) throw badRequest('defaultRole must be admin, member or guest');
  const sessionHours = body.sessionHours ?? prev?.sessionHours ?? 24;
  if (!Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > 720) throw badRequest('sessionHours must be between 1 and 720');
  const enabled = body.enabled === true;

  let saml = { entityId: null as string | null, ssoUrl: null as string | null, certs: null as string | null };
  let oidc = { issuer: null as string | null, clientId: null as string | null, secret: null as string | null };
  // Settings changed without new provider details (enable, default role, session length) keep the provider.
  const keepProvider = prev?.protocol === protocol && !body.samlMetadataXml && !body.samlEntityId && !body.samlSsoUrl && !body.samlCertificate && !body.oidcIssuer && !body.oidcClientId && !body.oidcClientSecret;
  if (keepProvider && prev) {
    saml = { entityId: prev.samlEntityId, ssoUrl: prev.samlSsoUrl, certs: prev.samlCerts };
    oidc = { issuer: prev.oidcIssuer, clientId: prev.oidcClientId, secret: prev.oidcClientSecret };
  } else if (protocol === 'saml') {
    if (typeof body.samlMetadataXml === 'string' && body.samlMetadataXml.trim()) {
      const m = parseIdpMetadata(body.samlMetadataXml);
      saml = { entityId: m.entityId, ssoUrl: m.ssoUrl, certs: m.certs.join('\n') };
    } else {
      saml = {
        entityId: str(body.samlEntityId, 'The identity provider’s entity ID', 1024),
        ssoUrl: checkHttpsUrl(str(body.samlSsoUrl, 'The identity provider’s SSO URL'), 'The SSO URL'),
        certs: normalizeCertificate(str(body.samlCertificate, 'The identity provider’s signing certificate', 64 * 1024)),
      };
    }
  } else {
    const issuer = checkHttpsUrl(str(body.oidcIssuer, 'The issuer URL'), 'The issuer URL').replace(/\/$/, '');
    const clientId = str(body.oidcClientId, 'The client ID', 512);
    const secretIn = typeof body.oidcClientSecret === 'string' ? body.oidcClientSecret.trim() : '';
    const keep = prev?.protocol === 'oidc' && prev.oidcIssuer === issuer && prev.oidcClientId === clientId ? prev.oidcClientSecret : null;
    const secret = secretIn ? seal(CLIENT_SECRET_PURPOSE, secretIn) : keep;
    if (!secret) throw badRequest('The client secret is required');
    oidc = { issuer, clientId, secret };
  }
  const providerChanged =
    !prev ||
    prev.protocol !== protocol ||
    (protocol === 'saml' ? prev.samlEntityId !== saml.entityId || prev.samlSsoUrl !== saml.ssoUrl || prev.samlCerts !== saml.certs : prev.oidcIssuer !== oidc.issuer || prev.oidcClientId !== oidc.clientId);
  await repo.saveConnection(
    {
      workspaceId,
      protocol,
      enabled,
      defaultRole,
      sessionHours,
      samlEntityId: saml.entityId,
      samlSsoUrl: saml.ssoUrl,
      samlCerts: saml.certs,
      oidcIssuer: oidc.issuer,
      oidcClientId: oidc.clientId,
      oidcClientSecret: oidc.secret,
    },
    providerChanged,
    Date.now(),
  );
  // AUDIT(KAI-48): emit `sso.connection_saved` { workspaceId, protocol, enabled, providerChanged } once the audit log lands.
  log(`sso: workspace ${workspaceId} saved its ${protocol} connection (enabled: ${enabled}${providerChanged ? ', new provider' : ''})`);
}

export async function removeConnection(workspaceId: string): Promise<void> {
  await repo.deleteConnection(workspaceId);
  // AUDIT(KAI-48): emit `sso.connection_removed` { workspaceId } once the audit log lands.
  log(`sso: workspace ${workspaceId} removed its SSO connection`);
}

/**
 * Turns "Enforce SSO" on or off. On needs: the connection enabled, a sign-in that went through it
 * (so a broken configuration can't lock everyone out), and a break-glass person who is an owner
 * and keeps password sign-in for repairs. Turning it on ends every other session of the people at
 * the verified domains (except the break-glass owner's), on every instance: from then on they are
 * signed in only through the identity provider.
 */
export async function setEnforcement(workspaceId: string, actorRole: WorkspaceRole, body: { enforced?: unknown; breakGlassUserId?: unknown }): Promise<number> {
  const enforced = body.enforced === true;
  const c = await repo.getConnection(workspaceId);
  if (!c) throw badRequest('Set up the identity provider first');
  let breakGlass: string | null = null;
  if (enforced) {
    if (actorRole !== 'owner') throw new HttpError(403, 'Only a workspace owner can enforce single sign-on');
    if (typeof body.breakGlassUserId !== 'string' || !body.breakGlassUserId) throw badRequest('Choose the owner who keeps password sign-in (break-glass)');
    if ((await workspaceRole(workspaceId, body.breakGlassUserId)) !== 'owner') throw badRequest('The break-glass person must be an owner of this workspace');
    breakGlass = body.breakGlassUserId;
  }
  if (!(await repo.setEnforced(workspaceId, enforced, breakGlass, Date.now())))
    throw new HttpError(409, 'Sign in through the identity provider once (with the connection enabled) before enforcing it');
  let ended = 0;
  if (enforced) {
    const method = ssoMethod(workspaceId);
    for (const domain of await verifiedDomainsOf(workspaceId))
      for (const userId of await userIdsAtDomain(domain)) if (userId !== breakGlass) ended += await endSessionsOf(userId, null, method);
  }
  // AUDIT(KAI-48): emit `sso.enforcement_changed` { workspaceId, enforced, breakGlassUserId, sessionsEnded } once the audit log lands.
  log(`sso: workspace ${workspaceId} ${enforced ? `enforces SSO (ended ${ended} other sessions)` : 'no longer enforces SSO'}`);
  return ended;
}
