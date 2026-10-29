// What the Connect page lists: app consents and personal tokens as one list, each "connected" once
// its client has called Freero (the server stamps last use on every authenticated call) and while
// it still works (not paused, not expired).
import type { ApiScope, AuthorizedApp, PersonalToken } from '@freero/shared';

export interface Connection {
  key: string;
  kind: 'app' | 'token';
  /** The app's client id, or the token's id: what revoking takes. */
  id: string;
  name: string;
  scopes: ApiScope[];
  /** What it connects to: "MCP server", "REST API", "Personal token …abcd". */
  via: string;
  addedAt: number;
  lastUsedAt: number | null;
  connected: boolean;
  /** Why it can't be used right now ("Paused", "Expired"), or null. */
  problem: string | null;
}

const RESOURCE_NAME: Record<string, string> = { '/mcp': 'MCP server', '/api/v1': 'REST API' };

export function connectionStates(apps: AuthorizedApp[], tokens: PersonalToken[], now = Date.now()): Connection[] {
  const list: Connection[] = [
    ...apps.map((a): Connection => ({
      key: `app:${a.clientId}`,
      kind: 'app',
      id: a.clientId,
      name: a.name,
      scopes: a.scopes,
      via: RESOURCE_NAME[a.resource] ?? a.resource,
      addedAt: a.authorizedAt,
      lastUsedAt: a.lastUsedAt,
      connected: a.lastUsedAt !== null,
      problem: null,
    })),
    ...tokens.map((t): Connection => {
      const problem = t.paused ? 'Paused' : t.expiresAt !== null && t.expiresAt <= now ? 'Expired' : null;
      return {
        key: `token:${t.id}`,
        kind: 'token',
        id: t.id,
        name: t.name,
        scopes: t.scopes,
        via: `Personal token …${t.hint}`,
        addedAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
        connected: t.lastUsedAt !== null && problem === null,
        problem,
      };
    }),
  ];
  // Newest activity first: what was just connected is at the top.
  return list.sort((a, b) => (b.lastUsedAt ?? b.addedAt) - (a.lastUsedAt ?? a.addedAt));
}
