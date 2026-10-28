// The personal data modules/apiauth keeps about a person, for their data export (modules/privacy):
// their API tokens, the apps they authorised and the apps they registered. Never a secret or hash.
import * as repo from './repo';

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export async function apiDataOf(userId: string) {
  const { tokens, apps, clients } = await repo.grantsAndTokensForExport(userId);
  return {
    personalAccessTokens: tokens.map((t) => ({
      name: t.name,
      endsWith: t.hint,
      scopes: t.scopes,
      createdAt: iso(t.createdAt),
      expiresAt: iso(t.expiresAt),
      lastUsedAt: iso(t.lastUsedAt),
      paused: t.pausedAt !== null,
    })),
    authorisedApps: apps.map((g) => ({
      app: g.client.name,
      clientId: g.clientId,
      website: g.client.website,
      scopes: g.scopes,
      resource: g.resource,
      authorisedAt: iso(g.createdAt),
      lastUsedAt: iso(g.lastUsedAt),
    })),
    registeredApps: clients.map((c) => ({
      name: c.name,
      clientId: c.id,
      website: c.website,
      redirectUris: c.redirectUris,
      confidential: c.secretHash !== null,
      createdAt: iso(c.createdAt),
      authorisedBy: c.users,
    })),
  };
}
