// What the data exports hold of tracker sync (#43, privacy/archive.ts): a person's own connections
// and the issues they linked to board items; a workspace's connections. Never credentials, webhook
// secrets or OAuth tokens — only what the connection is (tracker, name, site, account) and how it
// maps fields.
import type { TrackerProviderKind } from '@freero/shared';
import * as repo from './repo';
import type { StoredConnection } from './repo';

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

function connectionOf(c: StoredConnection, links?: number) {
  return {
    id: c.id,
    provider: c.provider as TrackerProviderKind,
    name: c.name,
    site: c.site,
    deployment: c.deployment,
    auth: c.auth,
    inbound: c.inbound,
    status: c.status,
    account: c.settings.account ?? null,
    defaults: { project: c.settings.project ?? null, issueType: c.settings.issueType ?? null, issueTypes: c.settings.issueTypes ?? {} },
    fieldMap: c.settings.fieldMap ?? [],
    ...(links !== undefined ? { linkedIssues: links } : {}),
    createdAt: iso(c.createdAt),
  };
}

/** A person's own tracker connections and the issues they linked (credentials never). */
export async function trackersExportOf(userId: string) {
  const own = await repo.listConnections({ ownerId: userId });
  const counts = await repo.countLinks(own.map((c) => c.id));
  const links = await repo.linksMadeBy(userId);
  return {
    connections: own.map((c) => connectionOf(c, counts.get(c.id) ?? 0)),
    linkedIssues: links.map((l) => ({
      provider: l.provider,
      connection: l.connectionName,
      issue: l.externalKey,
      url: l.externalUrl,
      boardId: l.boardId,
      items: l.sources,
      state: l.state,
      createdAt: iso(l.createdAt),
      syncedAt: iso(l.syncedAt),
    })),
  };
}

/** A workspace's tracker connections (its admins' settings; credentials never). */
export async function trackersWorkspaceExportOf(workspaceId: string) {
  const list = await repo.listConnections({ workspaceId });
  const counts = await repo.countLinks(list.map((c) => c.id));
  return list.map((c) => connectionOf(c, counts.get(c.id) ?? 0));
}
