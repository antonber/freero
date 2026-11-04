// A team workspace's identity provider: its settings (owners/admins), and "Enforce SSO".
import type { Request } from 'express';
import type { SsoConnectionInput, SsoSettings, WorkspaceRole } from '@freero/shared';
import { badRequest, HttpError } from '../../platform/http';
import { appUrl } from '../../platform/mail';
import { seal } from '../../platform/secrets';
import { recordAudit } from '../audit/index';
import { endSessionsOf, userIdsAtDomain } from '../auth/index';
import { getWorkspaceInfo, workspaceRole } from '../workspaces/index';
import { txtName, txtValue } from './dns';
import { verifiedDomainsOf } from './domains';
import * as repo from './repo';
import { certificateInfo, checkHttpsUrl, normalizeCertificate, parseIdpMetadata, splitCertificates } from './saml';
import { spKeysOf } from './spKeys';

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
    // Single logout (#13): the IdP's LogoutRequest / LogoutResponse, HTTP-Redirect or HTTP-POST.
    sloUrl: `${base}/saml/slo`,
  };
}

/** The sign-in method (session, identity provider id) of a workspace's single sign-on. */
export const ssoMethod = (workspaceId: string) => `sso:${workspaceId}`;

export async function ssoSettings(req: Request | null, workspaceId: string): Promise<SsoSettings> {
  const [domains, c, spKeys] = await Promise.all([repo.listDomains(workspaceId), repo.getConnection(workspaceId), spKeysOf(workspaceId)]);
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
      saml:
        c.protocol === 'saml' && c.samlEntityId && c.samlSsoUrl
          ? {
              entityId: c.samlEntityId,
              ssoUrl: c.samlSsoUrl,
              certificates: splitCertificates(c.samlCerts).map(certificateInfo),
              sloUrl: c.samlSloUrl,
              requireEncryptedAssertions: c.requireEncrypted,
              signRequests: c.signRequests,
            }
          : null,
      oidc: c.protocol === 'oidc' && c.oidcIssuer && c.oidcClientId ? { issuer: c.oidcIssuer, clientId: c.oidcClientId, hasClientSecret: !!c.oidcClientSecret } : null,
      testedAt: c.testedAt,
      idpInitiated: c.protocol === 'saml' && c.idpInitiated,
    },
    serviceProvider: serviceProviderUrls(req, workspaceId),
    spKeys,
  };
}

const str = (v: unknown, what: string, max = 2048): string => {
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${what} is required`);
  if (v.length > max) throw badRequest(`${what} is too long`);
  return v.trim();
};

/** Saves the identity provider. Pointing it at another provider turns enforcement off until a sign-in proves it. */
export async function saveConnection(workspaceId: string, actorId: string, body: Partial<SsoConnectionInput>): Promise<void> {
  const protocol = body.protocol;
  if (protocol !== 'saml' && protocol !== 'oidc') throw badRequest('protocol must be saml or oidc');
  const prev = await repo.getConnection(workspaceId);
  const defaultRole = body.defaultRole ?? prev?.defaultRole ?? 'member';
  if (!(DIRECTORY_ROLES as readonly string[]).includes(defaultRole)) throw badRequest('defaultRole must be admin, member or guest');
  // An organisation's directory has owners, admins and members; team membership comes from its workspaces (#108).
  if (defaultRole === 'guest' && (await getWorkspaceInfo(workspaceId))?.kind === 'organisation')
    throw badRequest('People who sign in through an organisation join its directory as members or admins');
  const enabled = body.enabled === true;
  // Omitted (enable/disable, default role): unchanged. Only SAML has IdP-initiated sign-in.
  if (body.idpInitiated !== undefined && typeof body.idpInitiated !== 'boolean') throw badRequest('idpInitiated must be true or false');
  const idpInitiated = protocol === 'saml' && (body.idpInitiated ?? (prev?.protocol === 'saml' && prev.idpInitiated));
  // #13: encrypted assertions and signed requests need a key pair of our own (spKeys.ts).
  for (const k of ['requireEncryptedAssertions', 'signRequests'] as const)
    if (body[k] !== undefined && typeof body[k] !== 'boolean') throw badRequest(`${k} must be true or false`);
  const wasSaml = prev?.protocol === 'saml';
  const requireEncrypted = protocol === 'saml' && (body.requireEncryptedAssertions ?? (wasSaml && prev.requireEncrypted));
  const signRequests = protocol === 'saml' && (body.signRequests ?? (wasSaml && prev.signRequests));
  if ((requireEncrypted || signRequests) && !(await spKeysOf(workspaceId)).length)
    throw badRequest('Create a service-provider key first: encrypted assertions and signed requests use it');

  let saml = { entityId: null as string | null, ssoUrl: null as string | null, certs: null as string | null, sloUrl: null as string | null };
  let oidc = { issuer: null as string | null, clientId: null as string | null, secret: null as string | null };
  // Settings changed without new provider details (enable, default role) keep the provider.
  const keepProvider = prev?.protocol === protocol && !body.samlMetadataXml && !body.samlEntityId && !body.samlSsoUrl && !body.samlCertificate && !body.oidcIssuer && !body.oidcClientId && !body.oidcClientSecret;
  if (keepProvider && prev) {
    saml = { entityId: prev.samlEntityId, ssoUrl: prev.samlSsoUrl, certs: prev.samlCerts, sloUrl: prev.samlSloUrl };
    oidc = { issuer: prev.oidcIssuer, clientId: prev.oidcClientId, secret: prev.oidcClientSecret };
  } else if (protocol === 'saml') {
    if (typeof body.samlMetadataXml === 'string' && body.samlMetadataXml.trim()) {
      const m = parseIdpMetadata(body.samlMetadataXml);
      saml = { entityId: m.entityId, ssoUrl: m.ssoUrl, certs: m.certs.join('\n'), sloUrl: m.sloUrl ?? null };
    } else {
      saml = {
        entityId: str(body.samlEntityId, 'The identity provider’s entity ID', 1024),
        ssoUrl: checkHttpsUrl(str(body.samlSsoUrl, 'The identity provider’s SSO URL'), 'The SSO URL'),
        certs: normalizeCertificate(str(body.samlCertificate, 'The identity provider’s signing certificate', 64 * 1024)),
        sloUrl: wasSaml ? prev.samlSloUrl : null,
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
  // The IdP's single logout URL typed in (#13): '' clears it; omitted keeps it (or the metadata's).
  if (protocol === 'saml' && body.samlSloUrl !== undefined) {
    if (typeof body.samlSloUrl !== 'string' || body.samlSloUrl.length > 2048) throw badRequest('samlSloUrl must be a URL');
    saml.sloUrl = body.samlSloUrl.trim() ? checkHttpsUrl(body.samlSloUrl.trim(), 'The single logout URL') : null;
  }
  const providerChanged =
    !prev ||
    prev.protocol !== protocol ||
    (protocol === 'saml' ? prev.samlEntityId !== saml.entityId || prev.samlSsoUrl !== saml.ssoUrl || prev.samlCerts !== saml.certs : prev.oidcIssuer !== oidc.issuer || prev.oidcClientId !== oidc.clientId);
  await repo.transaction(async () => {
    await repo.saveConnection(
      {
        workspaceId,
        protocol,
        enabled,
        defaultRole,
        samlEntityId: saml.entityId,
        samlSsoUrl: saml.ssoUrl,
        samlCerts: saml.certs,
        oidcIssuer: oidc.issuer,
        oidcClientId: oidc.clientId,
        oidcClientSecret: oidc.secret,
        idpInitiated,
        samlSloUrl: protocol === 'saml' ? saml.sloUrl : null,
        requireEncrypted,
        signRequests,
      },
      providerChanged,
      Date.now(),
    );
    await recordAudit({
      action: 'sso.connection_saved',
      workspaceId,
      actorId,
      target: { type: 'sso', id: workspaceId, label: protocol === 'saml' ? saml.entityId : oidc.issuer },
      metadata: {
        protocol,
        enabled,
        defaultRole,
        idpInitiated,
        requireEncryptedAssertions: requireEncrypted,
        signRequests,
        singleLogout: protocol === 'saml' && !!saml.sloUrl,
        providerChanged,
        // A new provider turns enforcement off until a sign-in proves it.
        enforcementDropped: providerChanged && !!prev?.enforced,
      },
    });
  });
}

export async function removeConnection(workspaceId: string, actorId: string): Promise<void> {
  await repo.transaction(async () => {
    if (!(await repo.deleteConnection(workspaceId))) return;
    await recordAudit({ action: 'sso.connection_removed', workspaceId, actorId, target: { type: 'sso', id: workspaceId } });
  });
}

/**
 * Turns "Enforce SSO" on or off. On needs: the connection enabled, a sign-in that went through it
 * (so a broken configuration can't lock everyone out), and a break-glass person who is an owner
 * and keeps password sign-in for repairs. Turning it on ends every other session of the people at
 * the verified domains (except the break-glass owner's), on every instance: from then on they are
 * signed in only through the identity provider.
 */
export async function setEnforcement(
  workspaceId: string,
  actor: { id: string; role: WorkspaceRole },
  body: { enforced?: unknown; breakGlassUserId?: unknown },
): Promise<number> {
  const enforced = body.enforced === true;
  const c = await repo.getConnection(workspaceId);
  if (!c) throw badRequest('Set up the identity provider first');
  let breakGlass: string | null = null;
  if (enforced) {
    if (actor.role !== 'owner') throw new HttpError(403, 'Only a workspace owner can enforce single sign-on');
    if (typeof body.breakGlassUserId !== 'string' || !body.breakGlassUserId) throw badRequest('Choose the owner who keeps password sign-in (break-glass)');
    if ((await workspaceRole(workspaceId, body.breakGlassUserId)) !== 'owner') throw badRequest('The break-glass person must be an owner of this workspace');
    breakGlass = body.breakGlassUserId;
  }
  await repo.transaction(async () => {
    if (!(await repo.setEnforced(workspaceId, enforced, breakGlass, Date.now())))
      throw new HttpError(409, 'Sign in through the identity provider once (with the connection enabled) before enforcing it');
    await recordAudit({
      action: enforced ? 'sso.enforced' : 'sso.unenforced',
      workspaceId,
      actorId: actor.id,
      target: { type: 'sso', id: workspaceId },
      metadata: { breakGlassUserId: breakGlass },
    });
  });
  let ended = 0;
  if (enforced) {
    const method = ssoMethod(workspaceId);
    for (const domain of await verifiedDomainsOf(workspaceId))
      for (const userId of await userIdsAtDomain(domain)) if (userId !== breakGlass) ended += await endSessionsOf(userId, null, method);
  }
  return ended;
}
