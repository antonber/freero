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
import type { StructurePlacement } from './api';
import type { FieldDef } from './fields';
import { labelKey } from './fieldText';

export const TRACKER_PROVIDERS = {
  jira: 'Jira',
  linear: 'Linear',
  github: 'GitHub',
  azure: 'Azure DevOps',
  asana: 'Asana',
  monday: 'monday.com',
  clickup: 'ClickUp',
  trello: 'Trello',
} as const;
export type TrackerProviderKind = keyof typeof TRACKER_PROVIDERS;

/** The board collection holding one TrackerIssueRecord per linked issue (key: the link id). */
export const TRACKER_COLLECTION = 'trackers';

/** Where an issue stands, in the board's terms (a card's status / a kanban column). */
export type IssueStatusCategory = 'todo' | 'doing' | 'done';

export const ISSUE_FIELDS = ['title', 'description', 'status', 'statusName', 'priority', 'assignee', 'labels', 'startDate', 'dueDate', 'estimate', 'sprint'] as const;
/** The fields every tracker knows of (each provider syncs the ones it has). */
export type BuiltinIssueField = (typeof ISSUE_FIELDS)[number];
/**
 * A synced field: a built-in one, or `custom:<tracker field id>` — a field the connection's field
 * map (#43) pairs with a kanban field ("customfield_10050" ↔ the kanban's "Team").
 */
export type IssueField = BuiltinIssueField | `custom:${string}`;
export const ISSUE_FIELD_LABELS: Record<BuiltinIssueField, string> = {
  title: 'Title',
  description: 'Description',
  status: 'Status',
  statusName: 'Workflow status',
  priority: 'Priority',
  assignee: 'Assignee',
  labels: 'Labels',
  startDate: 'Start date',
  dueDate: 'Due date',
  estimate: 'Estimate',
  sprint: 'Sprint',
};

export const customField = (trackerFieldId: string): IssueField => `custom:${trackerFieldId}`;
/** The tracker field id of a `custom:` field, else null. */
export const customFieldId = (f: IssueField): string | null => (f.startsWith('custom:') ? f.slice('custom:'.length) : null);

/** What people read for a field ("Sprint", or the map's name for a custom one: "Team"). */
export function issueFieldLabel(f: IssueField, map: readonly FieldMapEntry[] = []): string {
  const id = customFieldId(f);
  if (id === null) return ISSUE_FIELD_LABELS[f as BuiltinIssueField];
  return map.find((m) => m.tracker === id)?.board ?? id;
}

/** A mapped field's value: an option's label (select; a person's email), labels (multi-select), a number, 'YYYY-MM-DD' or text. */
export type CustomValue = string | number | string[] | null;

/** One field's value in `v` (undefined: that side has no such value). */
export function issueFieldValue(v: IssueValues, f: IssueField): unknown {
  const id = customFieldId(f);
  if (id === null) return (v as Record<string, unknown>)[f];
  return v.custom ? v.custom[id] : undefined;
}

/** `v` with field `f` set (undefined leaves it out). */
export function withIssueField(v: IssueValues, f: IssueField, value: unknown): IssueValues {
  const id = customFieldId(f);
  if (id === null) {
    const out = { ...v } as Record<string, unknown>;
    if (value === undefined) delete out[f];
    else out[f] = value;
    return out as IssueValues;
  }
  const custom = { ...(v.custom ?? {}) };
  if (value === undefined) delete custom[id];
  else custom[id] = value as CustomValue;
  return { ...v, custom };
}

/** Every field `v` holds, built-in ones first. */
export const fieldsIn = (v: IssueValues): IssueField[] => [
  ...ISSUE_FIELDS.filter((f) => v[f] !== undefined),
  ...Object.keys(v.custom ?? {})
    .filter((id) => v.custom![id] !== undefined)
    .map(customField),
];

// ---- the per-connection field map (#43) ----

/** What a tracker field holds, in the board's terms (a kanban field of the same kind holds it). */
export type MappedFieldType = 'select' | 'multiselect' | 'number' | 'date' | 'text' | 'person';
export const MAPPED_FIELD_TYPES: readonly MappedFieldType[] = ['select', 'multiselect', 'number', 'date', 'text', 'person'];

/**
 * One pair of the connection's field map: tracker field `tracker` ("customfield_10050",
 * "Custom.Team") ↔ the kanban field named `board` ("Team", case and spaces ignored) on any kanban
 * a linked card stands in. By the kanban field's NAME (a connection serves many kanbans, each with
 * its own field ids), by the tracker field's ID (renaming it in the tracker changes nothing).
 * A kanban without a field of that name holds no value for it: nothing is sent or cleared.
 */
export interface FieldMapEntry {
  tracker: string;
  /** The tracker field's name when it was mapped (shown; the id is what syncs). */
  trackerName: string;
  board: string;
  type: MappedFieldType;
}

/** A field the tracker has, for the field map's picker. */
export interface TrackerFieldInfo {
  id: string;
  name: string;
  /** The kind of kanban field that holds it; null: Freero can't map it. */
  type: MappedFieldType | null;
}

const FITS: Record<MappedFieldType, readonly string[]> = {
  select: ['select'],
  multiselect: ['multiselect'],
  number: ['number'],
  date: ['date'],
  text: ['text', 'url'],
  person: ['person'],
};

/** The kanban field a map entry reads and writes: the field of that name, of a kind that holds it. */
export function mappedKanbanField(schema: readonly FieldDef[], m: Pick<FieldMapEntry, 'board' | 'type'>): FieldDef | undefined {
  const f = schema.find((x) => labelKey(x.name) === labelKey(m.board));
  return f && FITS[m.type].includes(f.type) ? f : undefined;
}

// ---- sprints, cycles, iterations (#119) ----

/** A tracker's sprint (Jira), cycle (Linear) or iteration (Azure DevOps). */
export interface TrackerSprint {
  id: string;
  name: string;
  /** Closed sprints show on the cards that hold them and can't be picked. */
  state: 'active' | 'future' | 'closed';
  startDate?: string | null;
  endDate?: string | null;
}

/** What a kanban's field holding an issue's sprint may be called. */
export const SPRINT_FIELD_NAMES = ['Sprint', 'Cycle', 'Iteration'] as const;

/** A kanban's sprint field: the single select called Sprint, Cycle or Iteration (any case). */
export const sprintFieldOf = (schema: readonly FieldDef[]): FieldDef | undefined =>
  schema.find((f) => f.type === 'select' && SPRINT_FIELD_NAMES.some((n) => labelKey(n) === labelKey(f.name)));

/**
 * One issue's fields. `description` is Markdown-light: paragraphs, `- ` bullets and `[label](url)`
 * links — each provider writes it in its own format (Jira ADF / wiki markup, Markdown). `status` is
 * the category on the board side; the tracker's own status name rides along as `statusName` —
 * on the board side the label of the kanban column (Stage option) a card stands in, so a card
 * moved to "In review" asks the tracker for its "In review" status (step 2f). `priority`: the
 * tracker's priority level by name ("High"); on the board, the card's Priority field.
 * `assignee`: an email address (lowercase), or null for nobody.
 */
export interface IssueValues {
  title?: string;
  description?: string;
  status?: IssueStatusCategory | null;
  statusName?: string | null;
  /** The priority level's name, null for none (step 2f). */
  priority?: string | null;
  assignee?: string | null;
  labels?: string[];
  /** When work starts (KAI-160: a roadmap bar's first day), 'YYYY-MM-DD'. */
  startDate?: string | null;
  dueDate?: string | null;
  estimate?: number | null;
  /** The sprint / cycle / iteration by name (#119), null for none (the backlog). */
  sprint?: string | null;
  /** Mapped fields by tracker field id (#43): `custom:<id>` in IssueField terms. */
  custom?: Record<string, CustomValue>;
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
    startDate?: string | null;
    dueDate: string | null;
    /** A card's estimate when it is a number ("5", "0.5"); sizes like "M" don't map. */
    estimate: number | null;
    /**
     * A card in a kanban: the label of its Stage option (the column it stands in), and its
     * Priority field's label (null: none). Left out where there is no such thing (a card outside
     * a kanban, a kanban without a Priority field), so that side never pushes the field.
     */
    statusName?: string | null;
    priority?: string | null;
    /** The label of its kanban's Sprint field (null: none); left out without such a field. */
    sprint?: string | null;
    /** Values of the kanban fields the field map names, by tracker field id (a field the kanban lacks: left out). */
    custom?: Record<string, CustomValue>;
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
    if (card.startDate !== undefined) out.startDate = card.startDate;
    out.dueDate = card.dueDate;
    if (card.estimate !== null) out.estimate = card.estimate;
    if (card.statusName !== undefined) out.statusName = card.statusName;
    if (card.priority !== undefined) out.priority = card.priority;
    if (card.sprint !== undefined) out.sprint = card.sprint;
    if (card.custom && Object.keys(card.custom).length) out.custom = { ...card.custom };
  }
  return out;
}

/**
 * Which fields a change from the TRACKER may write back onto these items: a title and
 * description only into one item that holds them as such (a card; a sticky's text is its title),
 * labels into every tagged item, card fields into cards. A cluster's title and description are
 * made from its items and are never split back into them.
 */
export function pullableFields(sources: Array<Pick<TrackerSource, 'type' | 'card'>>, map: readonly Pick<FieldMapEntry, 'tracker'>[] = []): Set<IssueField> {
  const out = new Set<IssueField>();
  if (sources.length === 1) {
    out.add('title');
    if (sources[0].card) out.add('description');
  }
  if (sources.some((s) => s.type === 'sticky' || s.type === 'card')) out.add('labels');
  if (sources.some((s) => s.card)) {
    for (const f of ['status', 'statusName', 'priority', 'assignee', 'startDate', 'dueDate', 'estimate', 'sprint'] as const) out.add(f);
    for (const m of map) out.add(customField(m.tracker));
  }
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

/** A mapped field's value as compared: labels as a set, numbers rounded, text with spaces evened. */
function canonicalCustom(x: CustomValue | undefined): string | undefined {
  if (x === undefined) return undefined;
  if (x === null) return '';
  if (Array.isArray(x)) return [...new Set(x.map((l) => String(l).replace(/\s+/g, ' ').trim()).filter(Boolean))].sort().join('\n');
  if (typeof x === 'number') return Number.isFinite(x) ? String(Number(x.toFixed(4))) : '';
  return normText(String(x));
}

/** A field's value in the form both sides compare (undefined: this side has no such value). */
export function canonical(field: IssueField, v: IssueValues): string | undefined {
  const custom = customFieldId(field);
  if (custom !== null) return canonicalCustom(v.custom?.[custom]);
  switch (field as BuiltinIssueField) {
    case 'title':
      return v.title === undefined ? undefined : v.title.replace(/\s+/g, ' ').trim();
    case 'description':
      return v.description === undefined ? undefined : normText(v.description);
    case 'status':
      return v.status === undefined ? undefined : (v.status ?? '');
    case 'statusName':
      return v.statusName === undefined ? undefined : labelKey(v.statusName ?? '');
    case 'priority':
      return v.priority === undefined ? undefined : labelKey(v.priority ?? '');
    case 'assignee':
      return v.assignee === undefined ? undefined : (v.assignee ?? '').trim().toLowerCase();
    case 'labels':
      return v.labels === undefined ? undefined : [...new Set(v.labels.map((l) => l.trim().toLowerCase()).filter(Boolean))].sort().join('\n');
    case 'startDate':
      return v.startDate === undefined ? undefined : (v.startDate ?? '').slice(0, 10);
    case 'dueDate':
      return v.dueDate === undefined ? undefined : (v.dueDate ?? '').slice(0, 10);
    case 'estimate':
      return v.estimate === undefined ? undefined : v.estimate === null ? '' : String(Number(v.estimate.toFixed(4)));
    case 'sprint':
      return v.sprint === undefined ? undefined : labelKey(v.sprint ?? '');
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
  for (const f of new Set([...fieldsIn(board), ...fieldsIn(tracker)])) {
    const b = canonical(f, board);
    const t = canonical(f, tracker);
    if (b !== undefined) out.board[f] = b;
    if (t !== undefined) out.tracker[f] = t;
  }
  return out;
}

/**
 * What both sides agree on after a sync that merged the board's values as it READ them (`read`)
 * and wrote the `pulled` fields from the tracker onto the board (`after`: the board as that write
 * left it): a pulled field as written, every other field as read. A board change that landed while
 * the sync was talking to the tracker is no part of the base, so the next sync still sees it and
 * sends it (taking the board as it was after the write would agree to a change nobody sent).
 */
export function syncedBase(read: IssueValues, after: IssueValues, pulled: readonly IssueField[], tracker: IssueValues, previous?: SyncBase): SyncBase {
  let board: IssueValues = read;
  for (const f of pulled) board = withIssueField(board, f, issueFieldValue(after, f));
  const out = baseOf(board, tracker);
  // A pulled value the board had nowhere to put (the kanban field the map names was renamed or
  // removed) is NOT agreed: both sides keep what they last agreed, so once the board holds the
  // field again the tracker's value still reaches it, and the board's old value is never sent.
  if (previous)
    for (const f of pulled)
      if (canonical(f, after) === undefined) {
        for (const side of ['board', 'tracker'] as const) {
          if (previous[side][f] === undefined) delete out[side][f];
          else out[side][f] = previous[side][f];
        }
      }
  return out;
}


/**
 * The tracker's side of what a sync agreed on: the issue as the sync MERGED it (`merged`, read
 * before writing), with the fields it wrote either way (`written`: pushed and pulled) as the
 * tracker holds them after (`after`, read back). A change someone made in the tracker between the
 * write and the read-back is no part of it, so the next sync still brings it to the board.
 */
export function trackerAgreed(merged: IssueValues, after: IssueValues, written: readonly IssueField[]): IssueValues {
  let out = merged;
  for (const f of written) out = withIssueField(out, f, issueFieldValue(after, f));
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
// GET    /api/boards/:id/trackers/connections/:conn/sprints?project=KEY  -> { sprints: TrackerSprint[], fieldName } (#119)
// GET    /api/boards/:id/trackers/connections/:conn/issue-types?project=KEY -> { issueTypes: string[] } (#43)
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
// GET    /api/trackers/connections/:id/fields         -> { fields: TrackerFieldInfo[] } (managers: the field map's picker, #43)
// GET    /api/trackers/oauth/:provider/start?workspace=<id>|personal=1  -> 302 to the tracker's consent page
// POST   /api/trackers/webhooks/:connectionId         (the tracker; signed with the connection's secret)
// POST   /api/trackers/webhooks/:connectionId?h=&k=   (Asana, monday.com, ClickUp, Trello: a webhook Freero registered itself;
// HEAD   /api/trackers/webhooks/:connectionId?h=&k=   (Trello's check of an address: 200 only while Freero registers it)
//                                                      `k` binds the address to the connection's secret, and
//                                                      the handshake — Asana's X-Hook-Secret, monday's
//                                                      challenge — is answered only while Freero registers it)

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
  /**
   * [additive] How the connection's fields map (#43; managers set it): the tracker fields holding
   * story points and the start date (found by name when connecting, changeable), the issue type
   * per project, and custom fields paired with kanban fields.
   */
  fieldMap?: TrackerFieldMapSettings;
  /** Where the tracker sends webhooks (managers only). */
  webhookUrl?: string;
  links: number;
  createdAt: number;
}

/** The field map part of a connection (TrackerConnectionInfo.fieldMap; PATCH takes it whole). */
export interface TrackerFieldMapSettings {
  /** Tracker field id of story points / effort; null: none. */
  estimateField: string | null;
  startDateField: string | null;
  /** Issue (work item) type by project key, before the connection's default. */
  issueTypes: Record<string, string>;
  fields: FieldMapEntry[];
  /**
   * [additive] GitHub (#42): the Project (v2) whose fields sync ("acme/3": an organization or user
   * and the Project's number) — Status ↔ column, estimate, Iteration, start and target dates. New
   * issues join it; an issue in another Project uses the first one it is in.
   */
  planningProject?: string | null;
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
  /**
   * [additive] Trello (#181): the API key the token was made for (left out: the operator's key,
   * TRACKER_TRELLO_KEY), and optionally that key's secret, so webhook deliveries are verified by
   * their signature. Never sent back.
   */
  apiKey?: string;
  apiSecret?: string;
  inbound?: 'webhook' | 'polling';
  defaults?: { project?: string | null; issueType?: string | null };
  /** [additive] PATCH only (managers). */
  fieldMap?: Partial<TrackerFieldMapSettings>;
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
  /**
   * One issue for all of them (default), one per item, or (#43) `clusters`: one PARENT issue (an
   * epic: the frame's title, else the heading above them) with a child issue per cluster of the
   * items (items close together are a cluster, as the board outline reads them).
   */
  mode?: 'one' | 'each' | 'clusters';
  /** [additive] An existing issue the new ones go under (its key: "WEB-7", "ENG-3", "#12"); not GitHub. */
  parent?: string;
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
  /** [additive] mode `clusters`: the parent issue made for them. */
  parent?: { key: string; url: string };
}

export interface TrackerImportRequest {
  connectionId: string;
  /**
   * JQL (Jira), a search (Linear), a search query (GitHub), WIQL (Azure DevOps), a filter (Asana:
   * `project:<name> section:"Doing" assignee:me done:no words`; monday.com: `board:<name> group:"…"
   * status:"…" assignee:me words`). Not with `scope`.
   */
  query?: string;
  /**
   * [additive] Instead of a query (#119, #43): a project's issues in a sprint (`'current'`: the
   * active one; else a sprint id from `…/sprints`) and / or under an epic (its key). Into a kanban,
   * the kanban gets a Sprint field (Cycle on Linear, Iteration on Azure DevOps) with the project's
   * sprints as options, closed ones kept but not offered. [additive, #120/#121] Neither sprint nor
   * epic: the whole project (an Asana project, a monday.com board) up to `limit`.
   */
  scope?: { project: string; sprint?: string | null; epic?: string | null };

  limit?: number;
  /**
   * Roadmap mode (KAI-160): the issues become bars on this timeline instead of a grid of cards —
   * still linked task cards, so their dates sync both ways — in a lane per team, epic or label
   * (lanes are matched by name, missing ones added). Issues without dates go to an "Unscheduled"
   * frame below the timeline.
   */
  timeline?: { id: string; groupBy?: RoadmapGroupBy };
  /**
   * [additive] Where the cards go instead of a grid on free space (not with `timeline`): into an
   * existing frame, kanban (column) or cluster, or a new frame or kanban (StructurePlacement).
   * Placement never changes an issue's status: in a kanban a card goes to the column of its status
   * when the named column has another.
   */
  placement?: StructurePlacement;
}

/** How a roadmap import puts issues into lanes. */
export type RoadmapGroupBy = 'none' | 'team' | 'epic' | 'label';

/** What a tracker says an issue belongs to, for roadmap lanes (not synced fields). */
export interface IssueGroups {
  /** Jira: the project; Linear: the team; GitHub: the repository. */
  team?: string | null;
  /** Jira: the parent epic; Linear: the project (else the parent issue); GitHub: the milestone. */
  epic?: string | null;
}

/** The lane an issue goes to: its team / epic / first label (sorted), or null for "none". */
export function roadmapLaneOf(groupBy: RoadmapGroupBy, groups: IssueGroups | undefined, labels: readonly string[]): string | null {
  switch (groupBy) {
    case 'team':
      return groups?.team?.trim() || null;
    case 'epic':
      return groups?.epic?.trim() || null;
    case 'label':
      return [...labels].map((l) => l.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b))[0] ?? null;
    default:
      return null;
  }
}

export const ROADMAP_NO_GROUP: Record<RoadmapGroupBy, string> = { none: '', team: 'No team', epic: 'No epic', label: 'No label' };

export interface TrackerImportResponse {
  /** Cards created for issues new to this board. */
  created: string[];
  /** Roadmap imports: how many of them had no dates (in the "Unscheduled" frame). */
  unscheduled?: number;
  /** Issues already on this board (not imported twice). */
  skipped: number;
  /** [additive] Each new card with its issue, in the tracker's order. */
  cards?: Array<{ id: string; key: string; url: string; linkId: string }>;
  /** [additive] With `placement.newFrame` / `newKanban`: the frame or kanban made. */
  containerId?: string;
}
