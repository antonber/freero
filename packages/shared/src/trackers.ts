// Issue-tracker sync (KAI-153, KAI-154): what a board item means to a tracker issue, and the merge
// rule both sides of a sync follow. Pure: the server syncs with it, the web app previews with the
// server's answer, tests run it alone.
//
// A link is ONE tracker issue ↔ MANY board items (a sticky, a cluster of them, a card). The server
// keeps the truth (modules/trackers: connections, links, their sources, the last values both sides
// agreed on); the board shows it through the `trackers` collection (one TrackerIssueRecord per
// link, written only by the server) and each source item's `trackerLink`.
//
// Field values travel as `IssueValues` and are compared in CANONICAL form (`canonical`), so a
// tracker that reformats a description or reorders labels is not mistaken for an edit.

export const TRACKER_PROVIDERS = {
  jira: 'Jira',
  linear: 'Linear',
  github: 'GitHub',
} as const;
export type TrackerProviderKind = keyof typeof TRACKER_PROVIDERS;

/** The board collection holding one TrackerIssueRecord per linked issue (key: the link id). */
export const TRACKER_COLLECTION = 'trackers';

/** Where an issue stands, in the board's terms (a card's status / a kanban column). */
export type IssueStatusCategory = 'todo' | 'doing' | 'done';

export const ISSUE_FIELDS = ['title', 'description', 'status', 'assignee', 'labels', 'dueDate', 'estimate'] as const;
export type IssueField = (typeof ISSUE_FIELDS)[number];
export const ISSUE_FIELD_LABELS: Record<IssueField, string> = {
  title: 'Title',
  description: 'Description',
  status: 'Status',
  assignee: 'Assignee',
  labels: 'Labels',
  dueDate: 'Due date',
  estimate: 'Estimate',
};

/**
 * One issue's fields. `description` is Markdown-light: paragraphs, `- ` bullets and `[label](url)`
 * links — each provider writes it in its own format (Jira ADF / wiki markup, Markdown). `status` is
 * the category on the board side; the tracker's own status name rides along as `statusName`.
 * `assignee`: an email address (lowercase), or null for nobody.
 */
export interface IssueValues {
  title?: string;
  description?: string;
  status?: IssueStatusCategory | null;
  statusName?: string | null;
  assignee?: string | null;
  labels?: string[];
  dueDate?: string | null;
  estimate?: number | null;
}

/** What the board shows for a linked issue (the `trackers` collection; written by the server only). */
export interface TrackerIssueRecord {
  provider: TrackerProviderKind;
  /** The connection's name ("Jira · Acme"). */
  connection: string;
  /** The issue's key as the tracker shows it: "PROJ-12", "ENG-5", "acme/web#12". */
  key: string;
  /** The issue's page (https). Untrusted: check it before opening. */
  url: string;
  title: string;
  /** The tracker's status name ("In review") and its category. */
  status: string | null;
  statusCategory: IssueStatusCategory | null;
  /** Display name of the assignee in the tracker, or null. */
  assignee: string | null;
  /** The board items linked to the issue. */
  sources: string[];
  /** 'error': the last sync failed (`note` says why); 'disconnected': the connection is gone. */
  state: 'ok' | 'error' | 'paused' | 'disconnected';
  note?: string | null;
  syncedAt: number;
}

// ---- reading board items ----

/** One board item as the mapping reads it (the server builds these from the board view). */
export interface TrackerSource {
  id: string;
  type: string;
  /** A card's title, else the item's first line of text. */
  title: string;
  /** All of the item's text (a card: its description). */
  text: string;
  /** Names of its tags. */
  tags: string[];
  /** Only task cards carry these. */
  card?: {
    status: IssueStatusCategory | null;
    /** The assignee's email (resolved by the server), or null. */
    assignee: string | null;
    dueDate: string | null;
    /** A card's estimate when it is a number ("5", "0.5"); sizes like "M" don't map. */
    estimate: number | null;
  };
}

export interface MappingContext {
  /** What the cluster is called: the frame the sources share, or a heading just above them. */
  heading?: string | null;
  /** The web address of a board item (the issue's backlinks). */
  itemUrl(id: string): string;
}

const MAX_TITLE = 250;
const firstLine = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean) ?? '';
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * The issue a set of board items stands for. One card: its own fields. One other item: its
 * first line as the title and its text plus a link back as the description. Several: their
 * heading (a shared frame, a title above them) or the first item as the title and a bullet per
 * item with its link back. Labels are every source's tags; card fields come from the first card.
 */
export function issueValuesFromBoard(sources: TrackerSource[], ctx: MappingContext): IssueValues {
  if (!sources.length) return {};
  const out: IssueValues = {};
  const single = sources.length === 1 ? sources[0] : null;
  if (single?.card) {
    out.title = clip(single.title.trim() || 'Untitled', MAX_TITLE);
    out.description = single.text.trim();
  } else if (single) {
    out.title = clip(firstLine(single.title || single.text) || 'Untitled', MAX_TITLE);
    const body = single.text.trim();
    out.description = `${body ? `${body}\n\n` : ''}[Open on the Freero board](${ctx.itemUrl(single.id)})`;
  } else {
    const head = ctx.heading?.trim() || firstLine(sources[0].title || sources[0].text) || 'Untitled';
    out.title = clip(head, MAX_TITLE);
    out.description = [
      `From ${sources.length} items on a Freero board:`,
      '',
      ...sources.map((s) => `- ${clip((s.text || s.title).replace(/\s+/g, ' ').trim() || 'Untitled item', 500)} ([open](${ctx.itemUrl(s.id)}))`),
    ].join('\n');
  }
  out.labels = [...new Set(sources.flatMap((s) => s.tags.map((t) => t.trim()).filter(Boolean)))];
  const card = sources.find((s) => s.card)?.card;
  if (card) {
    out.status = card.status;
    out.assignee = card.assignee;
    out.dueDate = card.dueDate;
    if (card.estimate !== null) out.estimate = card.estimate;
  }
  return out;
}

/**
 * Which fields a change from the TRACKER may write back onto these items: a title and
 * description only into one item that holds them as such (a card; a sticky's text is its title),
 * labels into every tagged item, card fields into cards. A cluster's title and description are
 * made from its items and are never split back into them.
 */
export function pullableFields(sources: Array<Pick<TrackerSource, 'type' | 'card'>>): Set<IssueField> {
  const out = new Set<IssueField>();
  if (sources.length === 1) {
    out.add('title');
    if (sources[0].card) out.add('description');
  }
  if (sources.some((s) => s.type === 'sticky' || s.type === 'card')) out.add('labels');
  if (sources.some((s) => s.card)) for (const f of ['status', 'assignee', 'dueDate', 'estimate'] as const) out.add(f);
  return out;
}

// ---- comparing ----

const normText = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** A field's value in the form both sides compare (undefined: this side has no such value). */
export function canonical(field: IssueField, v: IssueValues): string | undefined {
  switch (field) {
    case 'title':
      return v.title === undefined ? undefined : v.title.replace(/\s+/g, ' ').trim();
    case 'description':
      return v.description === undefined ? undefined : normText(v.description);
    case 'status':
      return v.status === undefined ? undefined : (v.status ?? '');
    case 'assignee':
      return v.assignee === undefined ? undefined : (v.assignee ?? '').trim().toLowerCase();
    case 'labels':
      return v.labels === undefined ? undefined : [...new Set(v.labels.map((l) => l.trim().toLowerCase()).filter(Boolean))].sort().join('\n');
    case 'dueDate':
      return v.dueDate === undefined ? undefined : (v.dueDate ?? '').slice(0, 10);
    case 'estimate':
      return v.estimate === undefined ? undefined : v.estimate === null ? '' : String(Number(v.estimate.toFixed(4)));
  }
}

/** What each side looked like when they last agreed (canonical values). */
export interface SyncBase {
  board: Partial<Record<IssueField, string>>;
  tracker: Partial<Record<IssueField, string>>;
}

export type FieldDecision =
  /** Nothing changed (or this side can't take the change). */
  | 'none'
  /** Only the board changed: write it to the tracker. */
  | 'push'
  /** Only the tracker changed: write it onto the board items. */
  | 'pull'
  /** Both changed to the same value: just remember it. */
  | 'settle';

export interface FieldMerge {
  field: IssueField;
  decision: FieldDecision;
  /** Both sides changed the field differently since they last agreed (the tracker's value won). */
  conflict: boolean;
}

/**
 * The conflict policy, one field at a time, against the values both sides last agreed on:
 * - a change on ONE side flows to the other (whoever wrote last since the previous sync wins);
 * - the same field changed differently on BOTH sides within one sync window: the tracker wins —
 *   it is the system of record other people and automation read, record times are per issue /
 *   item rather than per field (so "who was last" would be a guess), and Freero keeps the board's
 *   value in a visible note instead of dropping it;
 * - status is the tracker's in any conflict for the same reason (workflows, transitions);
 * - a side that can't hold a field (a cluster's title) never overwrites it.
 */
export function mergeField(field: IssueField, base: SyncBase, board: IssueValues, tracker: IssueValues, can: { push: boolean; pull: boolean }): FieldMerge {
  const b = canonical(field, board);
  const t = canonical(field, tracker);
  const lastB = base.board[field];
  const lastT = base.tracker[field];
  const boardChanged = b !== undefined && lastB !== undefined && b !== lastB;
  const trackerChanged = t !== undefined && lastT !== undefined && t !== lastT;
  if (!boardChanged && !trackerChanged) return { field, decision: 'none', conflict: false };
  if (boardChanged && !trackerChanged) return { field, decision: can.push ? 'push' : 'none', conflict: false };
  if (!boardChanged) return { field, decision: can.pull ? 'pull' : 'none', conflict: false };
  if (b === t) return { field, decision: 'settle', conflict: false };
  return { field, decision: can.pull ? 'pull' : 'none', conflict: true };
}

/** A base where both sides agree on what they hold now (after a create, an import or a resync). */
export function baseOf(board: IssueValues, tracker: IssueValues): SyncBase {
  const out: SyncBase = { board: {}, tracker: {} };
  for (const f of ISSUE_FIELDS) {
    const b = canonical(f, board);
    const t = canonical(f, tracker);
    if (b !== undefined) out.board[f] = b;
    if (t !== undefined) out.tracker[f] = t;
  }
  return out;
}

/** Status category from a board card's status (CardStatus) — the same three values. */
export const isStatusCategory = (v: unknown): v is IssueStatusCategory => v === 'todo' || v === 'doing' || v === 'done';

/** A card's estimate as a number, when it is one. */
export function estimateNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string' || !/^\s*\d+(\.\d+)?\s*$/.test(v)) return null;
  return Number(v);
}

// ---- wire (REST: modules/trackers routes.ts) ----
//
// GET    /api/boards/:id/trackers                     -> BoardTrackersResponse (connections this person may use here)
// GET    /api/trackers/connections/:id/projects       -> { projects: TrackerProject[] }
// POST   /api/boards/:id/trackers/preview             TrackerSendRequest -> { issues: TrackerIssuePreview[] }
// POST   /api/boards/:id/trackers/send                TrackerSendRequest -> TrackerSendResponse
// POST   /api/boards/:id/trackers/import              TrackerImportRequest -> TrackerImportResponse
// POST   /api/boards/:id/trackers/links/:link/sync    -> { ok: true } (sync this issue now)
// DELETE /api/boards/:id/trackers/links/:link         -> { ok: true } (unlink; the issue stays)
// Connections (a team's: its owners/admins, `workspaceId`; personal: their owner):
// GET    /api/trackers/connections?workspace=<id>     -> { connections: TrackerConnectionInfo[] }
// POST   /api/trackers/connections                    TrackerConnectionInput -> { connection, webhookSecret? }
// PATCH  /api/trackers/connections/:id                Partial<TrackerConnectionInput> -> { connection }
// DELETE /api/trackers/connections/:id                -> { ok: true } (sync stops; board items stay)
// POST   /api/trackers/connections/:id/test           -> { ok: true, account } | 4xx with the tracker's answer in Freero's words
// POST   /api/trackers/connections/:id/webhook-secret -> { webhookSecret } (a new one; the old stops working)
// GET    /api/trackers/oauth/:provider/start?workspace=<id>|personal=1  -> 302 to the tracker's consent page
// POST   /api/trackers/webhooks/:connectionId         (the tracker; signed with the connection's secret)

export interface TrackerConnectionInfo {
  id: string;
  provider: TrackerProviderKind;
  name: string;
  /** A team's connection (its admins manage it, its members use it), or one person's own. */
  scope: 'workspace' | 'personal';
  workspaceId: string | null;
  /** The tracker's site ("https://acme.atlassian.net", "https://jira.acme.internal"). */
  site: string;
  /** Jira only: Cloud (REST v3, ADF) or Data Center / Server (REST v2, wiki markup). */
  deployment: 'cloud' | 'datacenter' | null;
  auth: 'oauth' | 'token';
  /** How changes in the tracker reach Freero. Polling also catches what a lost webhook missed. */
  inbound: 'webhook' | 'polling';
  status: 'active' | 'error' | 'needs_auth';
  lastError: string | null;
  /** The tracker account Freero acts as (from the last successful test). */
  account: string | null;
  defaults: { project: string | null; issueType: string | null };
  /** Where the tracker sends webhooks (managers only). */
  webhookUrl?: string;
  links: number;
  createdAt: number;
}

export interface TrackerConnectionInput {
  provider: TrackerProviderKind;
  name: string;
  /** Personal connection: omit. */
  workspaceId?: string | null;
  site: string;
  deployment?: 'cloud' | 'datacenter';
  /** Jira Cloud API tokens go with the account's email. */
  email?: string;
  /** API token / personal access token. Never sent back. */
  token?: string;
  inbound?: 'webhook' | 'polling';
  defaults?: { project?: string | null; issueType?: string | null };
}

export interface TrackerProject {
  id: string;
  key: string;
  name: string;
}

export interface BoardTrackersResponse {
  connections: Array<Pick<TrackerConnectionInfo, 'id' | 'provider' | 'name' | 'scope' | 'site' | 'defaults' | 'status'>>;
}

export interface TrackerSendRequest {
  connectionId: string;
  /** Project key (Jira), team key (Linear) or owner/repo (GitHub). */
  project: string;
  issueType?: string;
  itemIds: string[];
  /** One issue for all of them (default), or one per item. */
  mode?: 'one' | 'each';
}

export interface TrackerIssuePreview {
  itemIds: string[];
  values: IssueValues;
  /** Fields this tracker can't hold from these items, with why ("Estimate “M” is not a number"). */
  unmapped: string[];
}

export interface TrackerSendResponse {
  issues: Array<{
    linkId: string;
    key: string;
    url: string;
    itemIds: string[];
  }>;
}

export interface TrackerImportRequest {
  connectionId: string;
  /** JQL (Jira), a search (Linear), a search query (GitHub). */
  query: string;
  limit?: number;
}

export interface TrackerImportResponse {
  /** Cards created for issues new to this board. */
  created: string[];
  /** Issues already on this board (not imported twice). */
  skipped: number;
}
