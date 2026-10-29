// The provider interface: what Freero needs from a tracker. A new tracker is one file in this
// folder implementing it plus a line in providers/index.ts; the sync, the board, the admin
// console, webhooks and polling don't change.
import type { IncomingHttpHeaders } from 'node:http';
import type { IssueField, IssueGroups, IssueValues, TrackerProject, TrackerProviderKind } from '@freero/shared';
import type { HttpRequest, HttpResponse } from '../http';
import type { ConnectionSettings } from '../repo';

/** Opened credentials (never stored like this: sealed in the connection row). */
export type Credentials =
  /** API token (Jira Cloud with `email`), personal access token (Jira DC, GitHub), API key (Linear). */
  | { kind: 'token'; token: string; email?: string }
  | {
      kind: 'oauth';
      accessToken: string;
      refreshToken: string | null;
      expiresAt: number | null;
    };

/** A connection as a provider sees it: where to call, and an authenticated `call`. */
export interface ProviderConnection {
  id: string;
  provider: TrackerProviderKind;
  /** The site people browse ("https://acme.atlassian.net"). */
  site: string;
  /** Where API calls go (differs from `site` for Jira Cloud through OAuth). */
  apiBase: string;
  deployment: 'cloud' | 'datacenter' | null;
  settings: ConnectionSettings;
  /**
   * One authenticated API call (`path` relative to `apiBase`, or an absolute URL on it), with the
   * connection's credentials, rate-limit handling and retries. Resolves with any status.
   */
  call(req: Omit<HttpRequest, 'url'> & { path: string }): Promise<HttpResponse>;
}

/** An issue as the tracker has it now. */
export interface RemoteIssue {
  /** The tracker's stable id (Jira: numeric id; Linear: uuid; GitHub: owner/repo#number). */
  id: string;
  /** What people read ("PROJ-12"). */
  key: string;
  /** Its page (https). */
  url: string;
  values: IssueValues & {
    title: string;
    description: string;
    labels: string[];
  };
  /** Display name of the assignee, for the badge. */
  assigneeName: string | null;
  updatedAt: number;
  /** Team / epic the issue belongs to (roadmap lanes, KAI-160); not a synced field. */
  groups?: IssueGroups;
}

export interface CreateIssueInput {
  project: string;
  issueType: string | null;
  values: IssueValues;
}

export interface Backlink {
  /** The board item it points at (stable per issue: re-sending replaces, never duplicates). */
  itemId: string;
  url: string;
  title: string;
}

export interface WebhookDelivery {
  headers: IncomingHttpHeaders;
  rawBody: Buffer;
  /** The connection's webhook secret. */
  secret: string;
  now: number;
}

export interface TrackerProvider {
  kind: TrackerProviderKind;
  /** The fields this tracker syncs (the send preview lists the others as not mapped). */
  fields: readonly IssueField[];
  /** What the import query is, in the dialog ("JQL"). */
  queryLanguage: string;
  /** The headers that authenticate a call with these credentials. */
  authHeaders(creds: Credentials, conn: Pick<ProviderConnection, 'deployment'>): Record<string, string>;
  /** Who the credentials act as, plus what the connection should remember (estimate field…). */
  whoAmI(conn: ProviderConnection): Promise<{ account: string; settings?: Partial<ConnectionSettings> }>;
  listProjects(conn: ProviderConnection): Promise<TrackerProject[]>;
  /** Null when the issue no longer exists (or the connection can't see it any more). */
  getIssue(conn: ProviderConnection, id: string): Promise<RemoteIssue | null>;
  /** Creates an issue; `notes`: what couldn't be set, in Freero's words ("No Jira user for …"). */
  createIssue(conn: ProviderConnection, input: CreateIssueInput): Promise<{ issue: RemoteIssue; notes: string[] }>;
  /** Writes these fields (only the ones present); returns notes for what couldn't be written. */
  updateIssue(conn: ProviderConnection, issue: RemoteIssue, patch: IssueValues): Promise<string[]>;
  /** Issues matching a query in the tracker's own language (JQL, a search, a GitHub query). */
  search(conn: ProviderConnection, query: string, limit: number): Promise<RemoteIssue[]>;
  /** Which of these issues changed at or after `since` (polling). */
  changedSince(conn: ProviderConnection, issues: Array<{ id: string; key: string }>, since: number): Promise<string[]>;
  /** Makes the issue's links back to the board exactly `links` (adds, updates, removes `removed`). */
  setBacklinks(conn: ProviderConnection, issue: RemoteIssue, links: Backlink[], removed: string[]): Promise<void>;
  /** How a board tag becomes one of this tracker's labels (Jira labels can't hold spaces). */
  label(tag: string): string;
  /** The issues a webhook delivery is about (ids or keys), or null when its signature doesn't verify. */
  webhook(d: WebhookDelivery): { issues: string[] } | null;
}

/** OAuth 2.0 (authorization code) for providers that offer it to Freero's operator. */
export interface OAuthProvider {
  kind: TrackerProviderKind;
  authorizeUrl(p: { clientId: string; redirectUri: string; state: string }): string;
  /** Exchanges a code; resolves with credentials and the sites they reach. */
  redeem(p: { clientId: string; clientSecret: string; redirectUri: string; code: string }): Promise<{
    credentials: Extract<Credentials, { kind: 'oauth' }>;
    sites: Array<{ site: string; apiBase: string; name: string }>;
  }>;
  refresh(p: { clientId: string; clientSecret: string; refreshToken: string }): Promise<Extract<Credentials, { kind: 'oauth' }>>;
}

/** Thrown by `call` users when an answer isn't what the API promises. */
export const unexpected = (what: string, res: HttpResponse) => new Error(`${what}: unexpected answer ${res.status}`);
