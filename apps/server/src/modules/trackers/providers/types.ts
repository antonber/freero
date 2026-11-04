// The provider interface: what Freero needs from a tracker. A new tracker is one file in this
// folder implementing it plus a line in providers/index.ts; the sync, the board, the admin
// console, webhooks and polling don't change.
import type { IncomingHttpHeaders } from 'node:http';
import type { IssueField, IssueGroups, IssueValues, TrackerFieldInfo, TrackerProject, TrackerProviderKind, TrackerSprint } from '@freero/shared';
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
  /** The project (Jira key, Linear team key, Azure DevOps project) it is in, when the tracker says. */
  project?: string | null;
  /**
   * The issue's revision as read (Azure DevOps `rev`): a write names it, and the tracker refuses
   * the write when someone changed the issue since (TrackerError 'conflict').
   */
  version?: string | null;
}

export interface CreateIssueInput {
  project: string;
  issueType: string | null;
  values: IssueValues;
  /** The parent issue's key (an epic, a parent issue, a parent work item), #43. */
  parent?: string | null;
}

/** Which issues of a project an import takes, without a query (#119, #43). */
export interface IssueScope {
  project: string;
  /** A sprint id (from `sprints.list`), or null for any. ('current' is resolved before.) */
  sprint?: string | null;
  /** The parent / epic's key, or null for any. */
  epic?: string | null;
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
  /**
   * A webhook Freero registered itself (`TrackerProvider.webhooks`: Asana, monday.com, ClickUp), its address
   * already checked (it names the registration and carries a key made with the connection's
   * secret): whether Freero is registering it right now — the only time a handshake is answered —
   * and the secret the tracker issued in its handshake (Asana) or when it made the webhook (ClickUp).
   */
  hook?: { pending: boolean; secret: string | null };
}

export interface WebhookResult {
  /** The issues it is about (ids or keys); each is read back, never taken from the body. */
  issues: string[];
  /**
   * A handshake, answered with this instead of 202 and nothing queued: Asana's X-Hook-Secret echoed
   * (`keep`: the secret its deliveries will be signed with), monday.com's challenge echoed.
   */
  handshake?: { headers?: Record<string, string>; body?: unknown; keep?: string };
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
  /**
   * Writes these fields (only the ones present); returns notes for what couldn't be written — and,
   * where the tracker answers a write with the issue as it left it (Azure DevOps), that issue: the
   * sync agrees on it instead of reading the issue again, so a change someone makes right after
   * Freero's write is not taken as what Freero wrote (it is pulled by the next sync).
   */
  updateIssue(conn: ProviderConnection, issue: RemoteIssue, patch: IssueValues): Promise<string[] | { notes: string[]; issue: RemoteIssue }>;
  /**
   * The tracker's priority levels by name, most pressing first (Jira: the site's; Linear: its fixed
   * scale), for a kanban's Priority options; null / absent when it can't say (or has none: GitHub).
   */
  priorities?(conn: ProviderConnection): Promise<string[] | null>;
  /** Issues matching a query in the tracker's own language (JQL, a search, a GitHub query). */
  search(conn: ProviderConnection, query: string, limit: number): Promise<RemoteIssue[]>;
  /** A project's issues in a sprint and / or under an epic, without a query (#119, #43). */
  scoped?(conn: ProviderConnection, scope: IssueScope, limit: number): Promise<RemoteIssue[]>;
  /**
   * Sprints (#119): what the kanban field is called ("Sprint", "Cycle", "Iteration") and a
   * project's sprints, oldest first. Absent: the tracker has none Freero syncs (GitHub).
   */
  sprints?: { fieldName: string; list(conn: ProviderConnection, project: string): Promise<TrackerSprint[]> };
  /** The tracker's fields for the field map (#43); absent: it has no custom fields Freero maps. */
  listFields?(conn: ProviderConnection): Promise<TrackerFieldInfo[]>;
  /** The issue types a project can create (#43), for the send dialog. */
  issueTypes?(conn: ProviderConnection, project: string): Promise<string[]>;
  /**
   * Issues under a parent (#43): `CreateIssueInput.parent` is honoured, and a parent made for a
   * cluster of clusters is of this type (Jira "Epic"; null where the tracker has no types).
   */
  parents?: { issueType: string | null };

  /** Which of these issues changed at or after `since` (polling). */
  changedSince(conn: ProviderConnection, issues: Array<{ id: string; key: string }>, since: number): Promise<string[]>;
  /** Makes the issue's links back to the board exactly `links` (adds, updates, removes `removed`). */
  setBacklinks(conn: ProviderConnection, issue: RemoteIssue, links: Backlink[], removed: string[]): Promise<void>;
  /** How a board tag becomes one of this tracker's labels (Jira labels can't hold spaces). */
  label(tag: string): string;
  /** The issues a webhook delivery is about (ids or keys), or null when its signature doesn't verify. */
  webhook(d: WebhookDelivery): WebhookResult | null;
  /**
   * Webhooks Freero registers itself, one per project it sends to or imports from (Asana, monday.com,
   * ClickUp: people can't paste an address there). `register` may be called back by the tracker to
   * shake hands before it answers; `signed`: deliveries are signed with a secret the tracker issued
   * — in that handshake (Asana) or in its answer (`secret`: ClickUp) — so a registration without one
   * is no use.
   */
  webhooks?: {
    signed: boolean;
    register(conn: ProviderConnection, project: string, address: string): Promise<{ id: string; secret?: string }>;
    unregister(conn: ProviderConnection, id: string): Promise<void>;
  };
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
