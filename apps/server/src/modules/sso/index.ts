// Public API of modules/sso [S2]: single sign-on per team workspace — DNS-verified domains, a SAML
// 2.0 or OpenID Connect identity provider, just-in-time membership, "Enforce SSO".
import * as repo from './repo';

// The organization's own addresses (SCIM provisions only these).
export { isOrganizationEmail, verifiedDomainsOf } from './domains';

/** The role people get when they join the workspace through its directory (SSO default, else member). */
export async function defaultJoinRole(workspaceId: string): Promise<'admin' | 'member' | 'guest'> {
  return (await repo.getConnection(workspaceId))?.defaultRole ?? 'member';
}

/** For a person's data export: workspaces where they are the break-glass owner. */
export function ssoRolesOf(userId: string): Promise<Array<{ workspaceId: string; breakGlass: boolean }>> {
  return repo.personalSsoData(userId);
}

/** For a workspace export: its SSO settings without secrets. */
export async function ssoExportOf(workspaceId: string): Promise<unknown> {
  const [domains, c] = await Promise.all([repo.listDomains(workspaceId), repo.getConnection(workspaceId)]);
  return {
    domains: domains.map((d) => ({ domain: d.domain, verified: d.verifiedAt !== null })),
    connection: c && {
      protocol: c.protocol,
      enabled: c.enabled,
      enforced: c.enforced,
      breakGlassUserId: c.breakGlassUserId,
      defaultRole: c.defaultRole,
      samlEntityId: c.samlEntityId,
      samlSsoUrl: c.samlSsoUrl,
      oidcIssuer: c.oidcIssuer,
      oidcClientId: c.oidcClientId,
    },
  };
}
