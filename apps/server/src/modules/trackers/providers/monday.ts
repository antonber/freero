// monday.com (#121), through its public GraphQL API (https://api.monday.com/v2) with an API token
// or the operator's OAuth app. Items are the issues; a "project" is a board (its id). Freero reads
// each item's board for which column holds what: the first Status column (not one called
// Priority) is the card's column on a kanban — a board without one uses its groups — the first
// People column the assignee (by email), a Timeline column the start (and end, without a Date
// column) and the first Date column the due date. The description is an update ("post") on the
// item: the one Freero wrote, else the item's first. Mapped fields (#43) are columns by id.
//
//   Writes     only the columns that changed (change_multiple_column_values names just those), a
//              group move, the description update edited in place; never the whole item.
//   Backlinks  one update by Freero listing the board items, edited when they change.
//   Inbound    webhooks Freero registers per board (`webhooks`): monday.com shakes hands by posting
//              a challenge that must come back; deliveries are unsigned for API-made webhooks, so
//              the address itself carries a key made with the connection's secret (checked by
//              the service). Polling (updated_at) catches what a lost delivery missed.
//   Limits     GraphQL complexity: an exhausted budget waits briefly when monday.com says it resets
//              soon, else hands the wait back (the sync retries later); 429s like any tracker.
import {
  labelKey,
  TRACKER_PROVIDERS,
  type CustomValue,
  type FieldMapEntry,
  type IssueStatusCategory,
  type IssueValues,
  type MappedFieldType,
  type TrackerFieldInfo,
} from '@freero/shared';
import { getConfig } from '../../../platform/config';
import { trackerMessage, trackerRequest, TrackerError, type HttpResponse } from '../http';
import { htmlToMarkdown, markdownToHtml } from '../markup';
import type { Backlink, CreateIssueInput, Credentials, OAuthProvider, ProviderConnection, RemoteIssue, TrackerProvider, WebhookDelivery } from './types';

const LABEL = TRACKER_PROVIDERS.monday;
const API_VERSION = '2024-10';
const LINKS_MARK = 'On a Freero board:';

interface Column {
  id: string;
  title: string;
  type: string;
  settings_str?: string;
}
interface Board {
  id: string;
  name?: string;
  type?: string;
  columns?: Column[];
  groups?: Array<{ id: string; title: string }>;
}
interface ColumnValue {
  id: string;
  type?: string;
  text?: string | null;
  value?: string | null;
}
interface Update {
  id: string;
  body?: string;
  created_at?: string;
  creator?: { id?: string | number } | null;
}
interface Item {
  id: string;
  name?: string;
  state?: string;
  updated_at?: string;
  board?: Board;
  group?: { id: string; title: string } | null;
  parent_item?: { id: string; name?: string } | null;
  column_values?: ColumnValue[];
  updates?: Update[];
}

const BOARD = 'id name type columns { id title type settings_str } groups { id title }';
const ITEM = `id name state updated_at board { ${BOARD} } group { id title } parent_item { id name } column_values { id type text value } updates (limit: 50) { id body created_at creator { id } }`;

const ok = (res: HttpResponse) => res.status >= 200 && res.status < 300;
const ID = /^\d{1,20}$/;
const mapOf = (conn: ProviderConnection): FieldMapEntry[] => conn.settings.fieldMap ?? [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long monday.com asks to wait when a GraphQL complexity budget (or rate) is spent, else null. */
export function mondayRetryMs(json: unknown): number | null {
  const j = json as { errors?: Array<{ message?: string; extensions?: { code?: string; retry_in_seconds?: number } }>; error_code?: string; error_message?: string } | null;
  for (const e of j?.errors ?? []) {
    const code = e.extensions?.code ?? '';
    if (/COMPLEXITY|RATE_LIMIT|maxConcurrency/i.test(code) || /complexity budget|rate limit/i.test(e.message ?? ''))
      return Math.max(1, Number(e.extensions?.retry_in_seconds ?? /(\d+)\s*seconds?/i.exec(e.message ?? '')?.[1] ?? 60)) * 1000;
  }
  if (/Complexity|RateLimit/i.test(j?.error_code ?? '')) return Math.max(1, Number(/(\d+)\s*seconds?/i.exec(j?.error_message ?? '')?.[1] ?? 60)) * 1000;
  return null;
}

/** One GraphQL call; resolves with `data`, throws in Freero's words. A short complexity wait is waited once. */
async function gql<T>(conn: ProviderConnection, query: string, variables: Record<string, unknown>, what: string, opts: { wait?: (ms: number) => Promise<void> } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await conn.call({ method: 'POST', path: '/v2', headers: { 'api-version': API_VERSION }, body: { query, variables } });
    const j = res.json as { data?: T; errors?: unknown[]; error_code?: string; error_message?: string } | null;
    if (res.status === 401 || /Unauthorized|Not Authenticated/i.test(j?.error_code ?? '') || (res.status === 200 && /not authenticated/i.test(trackerMessage(j) ?? '')))
      throw new TrackerError(`${LABEL} refused the credentials. Check the connection’s API token.`, 'auth', 401);
    const wait = mondayRetryMs(j);
    if (wait !== null) {
      if (attempt === 0 && wait <= 5_000) {
        await (opts.wait ?? sleep)(wait);
        continue;
      }
      throw new TrackerError(`${LABEL} asked Freero to slow down (its complexity budget); the sync will try again shortly.`, 'rate', 429, wait);
    }
    if (!ok(res) || j?.errors?.length || j?.error_code || !j?.data) {
      const said = trackerMessage(j) ?? j?.error_message ?? null;
      if (res.status === 403 || /permission|forbidden|UserUnauthorized/i.test(said ?? '')) throw new TrackerError(`${LABEL} doesn’t allow this connection to ${what}${said ? ` (${said.slice(0, 200)})` : ''}.`, 'refused', 403);
      throw new TrackerError(`${LABEL} refused to ${what}${said ? `: ${said.slice(0, 300)}` : ` (${res.status})`}.`, 'invalid', res.status || 400);
    }
    return j.data;
  }
}

// ---- which column holds what, per board ----

const parse = <T>(s: string | null | undefined): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

export interface BoardColumns {
  status: Column | null;
  people: Column | null;
  date: Column | null;
  timeline: Column | null;
}

/** The columns Freero's own fields use on a board (the first of each kind; Priority is no status). */
export function columnsOf(board: Pick<Board, 'columns'> | undefined): BoardColumns {
  const cols = board?.columns ?? [];
  return {
    status: cols.find((c) => c.type === 'status' && !/priority/i.test(c.title)) ?? null,
    people: cols.find((c) => c.type === 'people' || c.type === 'multiple-person') ?? null,
    date: cols.find((c) => c.type === 'date') ?? null,
    timeline: cols.find((c) => c.type === 'timeline') ?? null,
  };
}

const DONE = /\b(done|completed?|finished|shipped|closed|released|resolved)\b/i;
const TODO = /^(|not started|to ?do|backlog|new|open|planned|ready|up next)$/i;

/** A status label's kind: done when the column marks it so (or it says so), to do when blank or not started, else doing. */
export function mondayCategory(label: string | null, done: boolean): IssueStatusCategory {
  const l = (label ?? '').trim();
  if (done || DONE.test(l)) return 'done';
  if (TODO.test(l)) return 'todo';
  return 'doing';
}

interface StatusSettings {
  labels?: Record<string, string>;
  done_colors?: number[];
}
const statusSettings = (c: Column): StatusSettings => parse<StatusSettings>(c.settings_str) ?? {};

const valueOf = (item: Item, id: string | undefined) => (id ? item.column_values?.find((v) => v.id === id) : undefined);

const dateOf = (v: ColumnValue | undefined): string | null => parse<{ date?: string }>(v?.value)?.date?.slice(0, 10) ?? null;
const peopleOf = (v: ColumnValue | undefined): string[] =>
  (parse<{ personsAndTeams?: Array<{ id: number | string; kind?: string }> }>(v?.value)?.personsAndTeams ?? []).filter((p) => (p.kind ?? 'person') === 'person').map((p) => String(p.id));

/** The update that is the item's description: the one Freero wrote, else its first (not the links one). */
function descriptionUpdate(item: Item, accountId: string | null | undefined): Update | null {
  const posts = [...(item.updates ?? [])].filter((u) => !htmlToMarkdown(u.body).startsWith(LINKS_MARK)).sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || Number(a.id) - Number(b.id));
  return (accountId ? posts.find((u) => String(u.creator?.id ?? '') === String(accountId)) : undefined) ?? posts[0] ?? null;
}

const linksUpdate = (item: Item, accountId: string | null | undefined): Update | null =>
  (item.updates ?? []).find((u) => htmlToMarkdown(u.body).startsWith(LINKS_MARK) && (!accountId || String(u.creator?.id ?? '') === String(accountId))) ?? null;

/** People's emails by monday.com user id (one call for every item read together). */
async function emailsOf(conn: ProviderConnection, ids: string[]): Promise<Map<string, { email: string | null; name: string | null }>> {
  const out = new Map<string, { email: string | null; name: string | null }>();
  const want = [...new Set(ids)].filter((id) => ID.test(id));
  if (!want.length) return out;
  const d = await gql<{ users?: Array<{ id: string | number; email?: string | null; name?: string | null }> }>(conn, 'query ($ids: [ID!]) { users (ids: $ids) { id name email } }', { ids: want }, 'look up people');
  for (const u of d.users ?? []) out.set(String(u.id), { email: u.email?.toLowerCase() ?? null, name: u.name ?? null });
  return out;
}

const siteOf = (conn: ProviderConnection) => (conn.settings.accountUrl ?? conn.site).replace(/\/+$/, '');

function customOf(type: MappedFieldType, v: ColumnValue | undefined, people: Map<string, { email: string | null; name: string | null }>): CustomValue | undefined {
  if (!v) return undefined;
  const text = (v.text ?? '').trim();
  switch (type) {
    case 'select':
      return text || null;
    case 'multiselect':
      return text ? text.split(',').map((s) => s.trim()).filter(Boolean) : [];
    case 'number':
      return text && Number.isFinite(Number(text)) ? Number(text) : null;
    case 'date':
      return dateOf(v);
    case 'person': {
      const first = peopleOf(v)[0];
      if (!first) return null;
      const p = people.get(first);
      return p?.email ?? `~${p?.name ?? first}`;
    }
    case 'text':
      return v.type === 'long_text' ? (parse<{ text?: string }>(v.value)?.text ?? text) || null : text || null;
  }
}

async function toRemotes(conn: ProviderConnection, items: Item[]): Promise<RemoteIssue[]> {
  const live = items.filter((i) => i.state !== 'deleted');
  const personIds: string[] = [];
  for (const i of live) {
    const c = columnsOf(i.board);
    personIds.push(...peopleOf(valueOf(i, c.people?.id)).slice(0, 1));
    for (const m of mapOf(conn)) if (m.type === 'person') personIds.push(...peopleOf(valueOf(i, m.tracker)).slice(0, 1));
  }
  const people = await emailsOf(conn, personIds);
  return live.map((i) => toRemote(conn, i, people));
}

function toRemote(conn: ProviderConnection, item: Item, people: Map<string, { email: string | null; name: string | null }>): RemoteIssue {
  const c = columnsOf(item.board);
  let statusName: string | null;
  let status: IssueStatusCategory;
  if (c.status) {
    const v = valueOf(item, c.status.id);
    const index = parse<{ index?: number }>(v?.value)?.index;
    statusName = (v?.text ?? '').trim() || null;
    status = mondayCategory(statusName, index !== undefined && (statusSettings(c.status).done_colors ?? []).includes(index));
  } else {
    statusName = item.group?.title ?? null;
    status = mondayCategory(statusName, false);
  }
  const who = peopleOf(valueOf(item, c.people?.id))[0];
  const person = who ? people.get(who) : undefined;
  const timeline = parse<{ from?: string; to?: string }>(valueOf(item, c.timeline?.id)?.value);
  const due = c.date ? dateOf(valueOf(item, c.date.id)) : (timeline?.to?.slice(0, 10) ?? null);
  const desc = descriptionUpdate(item, conn.settings.accountId);
  const board = item.board?.id ?? '';
  const custom = mapOf(conn).length
    ? Object.fromEntries(
        mapOf(conn).flatMap((m) => {
          const v = customOf(m.type, valueOf(item, m.tracker), people);
          return v === undefined ? [] : [[m.tracker, v]];
        }),
      )
    : null;
  return {
    id: String(item.id),
    key: String(item.id),
    url: `${siteOf(conn)}/boards/${board}/pulses/${item.id}`,
    values: {
      title: item.name ?? '',
      description: htmlToMarkdown(desc?.body),
      status,
      statusName,
      assignee: who ? (person?.email ?? `~${person?.name ?? who}`) : null,
      labels: [],
      startDate: c.timeline ? (timeline?.from?.slice(0, 10) ?? null) : null,
      dueDate: due,
      ...(custom ? { custom } : {}),
    },
    assigneeName: person?.name ?? null,
    updatedAt: item.updated_at ? Date.parse(item.updated_at) || 0 : 0,
    groups: { team: item.group?.title ?? null, epic: item.parent_item?.id ? String(item.parent_item.id) : null },
    project: board || null,
  };
}

async function readItems(conn: ProviderConnection, ids: string[]): Promise<Item[]> {
  const out: Item[] = [];
  const want = ids.filter((id) => ID.test(id));
  for (let i = 0; i < want.length; i += 50) {
    const d = await gql<{ items?: Item[] }>(conn, `query ($ids: [ID!]) { items (ids: $ids) { ${ITEM} } }`, { ids: want.slice(i, i + 50) }, 'read items');
    out.push(...(d.items ?? []));
  }
  return out;
}

async function readItem(conn: ProviderConnection, id: string): Promise<Item | null> {
  const item = (await readItems(conn, [id]))[0];
  return item && item.state !== 'deleted' ? item : null;
}

/** A board's items, page after page, up to `limit`. */
async function boardItems(conn: ProviderConnection, board: string, limit: number): Promise<Item[]> {
  if (!ID.test(board)) throw new TrackerError(`${board} isn’t a ${LABEL} board.`, 'invalid', 400);
  const first = await gql<{ boards?: Array<{ items_page?: { cursor?: string | null; items?: Item[] } }> }>(
    conn,
    `query ($board: [ID!], $limit: Int) { boards (ids: $board) { items_page (limit: $limit) { cursor items { ${ITEM} } } } }`,
    { board: [board], limit: Math.min(100, limit) },
    `list the items of board ${board}`,
  );
  const page = first.boards?.[0]?.items_page;
  if (!first.boards?.length) throw new TrackerError(`${LABEL} has no board ${board} this connection can see.`, 'not_found', 404);
  const out = [...(page?.items ?? [])];
  let cursor = page?.cursor ?? null;
  while (cursor && out.length < limit) {
    const next = await gql<{ next_items_page?: { cursor?: string | null; items?: Item[] } }>(
      conn,
      `query ($cursor: String!, $limit: Int) { next_items_page (cursor: $cursor, limit: $limit) { cursor items { ${ITEM} } } }`,
      { cursor, limit: Math.min(100, limit - out.length) },
      `list the items of board ${board}`,
    );
    out.push(...(next.next_items_page?.items ?? []));
    cursor = next.next_items_page?.cursor ?? null;
  }
  return out.slice(0, limit);
}

async function readBoard(conn: ProviderConnection, board: string): Promise<Board> {
  if (!ID.test(board)) throw new TrackerError(`${board} isn’t a ${LABEL} board.`, 'invalid', 400);
  const d = await gql<{ boards?: Board[] }>(conn, `query ($board: [ID!]) { boards (ids: $board) { ${BOARD} } }`, { board: [board] }, `read board ${board}`);
  const b = d.boards?.[0];
  if (!b) throw new TrackerError(`${LABEL} has no board ${board} this connection can see.`, 'not_found', 404);
  return b;
}

async function userIdByEmail(conn: ProviderConnection, email: string): Promise<string | null> {
  const d = await gql<{ users?: Array<{ id: string | number; email?: string }> }>(conn, 'query ($emails: [String]) { users (emails: $emails) { id email } }', { emails: [email] }, 'look up a person');
  const hit = (d.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
  return hit ? String(hit.id) : null;
}

/** `board:<id or name> group:"This week" status:Done assignee:me words…` → its parts. */
export function parseMondayFilter(q: string): { board?: string; group?: string; status?: string; assignee?: string; text: string } {
  const out: { board?: string; group?: string; status?: string; assignee?: string; text: string } = { text: '' };
  const rest: string[] = [];
  for (const m of q.matchAll(/(\w+):(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g)) {
    const key = m[1]?.toLowerCase();
    const value = (m[2] ?? m[3] ?? '').trim();
    if (key === 'board' || key === 'in') out.board = value;
    else if (key === 'group') out.group = value;
    else if (key === 'status' || key === 'column') out.status = value;
    else if (key === 'assignee' || key === 'person') out.assignee = value.toLowerCase();
    else rest.push(m[4] ?? m[5] ?? m[0]);
  }
  out.text = rest.join(' ').trim();
  return out;
}

// ---- writing ----

/** A column's value as change_multiple_column_values takes it ('' clears it). */
function columnWrite(col: Column, v: CustomValue, personId: string | null): unknown {
  if (v === null || v === '' || (Array.isArray(v) && !v.length && col.type !== 'dropdown')) return col.type === 'people' ? { personsAndTeams: [] } : '';
  switch (col.type) {
    case 'status':
      return { label: String(v) };
    case 'dropdown':
      return { labels: Array.isArray(v) ? v : [String(v)] };
    case 'numbers':
      return String(v);
    case 'date':
      return { date: String(v).slice(0, 10) };
    case 'people':
    case 'multiple-person':
      return { personsAndTeams: personId ? [{ id: Number(personId), kind: 'person' }] : [] };
    case 'long_text':
      return { text: String(v) };
    default:
      return String(v);
  }
}

/** The column values, group move and description that write `values` onto item `item` (only those present). */
async function write(conn: ProviderConnection, item: Item, values: IssueValues, board: Board): Promise<string[]> {
  const notes: string[] = [];
  const c = columnsOf(board);
  const cv: Record<string, unknown> = {};
  if (values.title !== undefined) cv.name = values.title.replace(/\s+/g, ' ').trim().slice(0, 255) || 'Untitled';
  if (values.assignee !== undefined) {
    if (!c.people) {
      if (values.assignee) notes.push(`Board “${board.name ?? board.id}” has no People column in ${LABEL}, so the assignee wasn’t sent.`);
    } else if (values.assignee === null) cv[c.people.id] = { personsAndTeams: [] };
    else if (!values.assignee.startsWith('~')) {
      const uid = await userIdByEmail(conn, values.assignee);
      if (uid) cv[c.people.id] = { personsAndTeams: [{ id: Number(uid), kind: 'person' }] };
      else notes.push(`No one in ${LABEL} has the address ${values.assignee}, so the assignee wasn’t sent.`);
    }
  }
  const timeline = parse<{ from?: string; to?: string }>(valueOf(item, c.timeline?.id)?.value) ?? {};
  if (values.dueDate !== undefined) {
    if (c.date) cv[c.date.id] = values.dueDate ? { date: values.dueDate } : '';
    else if (c.timeline) timeline.to = values.dueDate ?? undefined;
    else if (values.dueDate) notes.push(`Board “${board.name ?? board.id}” has no Date or Timeline column in ${LABEL}, so the due date wasn’t sent.`);
  }
  if (values.startDate !== undefined) {
    if (c.timeline) timeline.from = values.startDate ?? undefined;
    else if (values.startDate) notes.push(`Board “${board.name ?? board.id}” has no Timeline column in ${LABEL}, so the start date wasn’t sent.`);
  }
  if (c.timeline && (values.startDate !== undefined || (values.dueDate !== undefined && !c.date))) {
    // A timeline needs both ends: a lone one stands for both.
    const from = timeline.from ?? timeline.to;
    const to = timeline.to ?? timeline.from;
    cv[c.timeline.id] = from && to ? { from: from.slice(0, 10), to: (to < from ? from : to).slice(0, 10) } : '';
  }
  let group: { id: string; title: string } | null = null;
  if (values.statusName !== undefined || values.status !== undefined) {
    const want = values.status ?? null;
    if (c.status) {
      const s = statusSettings(c.status);
      const labels = Object.entries(s.labels ?? {}).filter(([, l]) => l.trim());
      const current = (valueOf(item, c.status.id)?.text ?? '').trim();
      const named = values.statusName ? labels.find(([, l]) => labelKey(l) === labelKey(values.statusName!)) : undefined;
      const kindOf = (i: string, l: string) => mondayCategory(l, (s.done_colors ?? []).includes(Number(i)));
      const currentKind = mondayCategory(current, labels.some(([i, l]) => l === current && (s.done_colors ?? []).includes(Number(i))));
      const byKind = !named && want && want !== currentKind ? labels.find(([i, l]) => kindOf(i, l) === want) : undefined;
      const target = named ?? byKind;
      if (target && target[1] !== current) cv[c.status.id] = { label: target[1] };
      else if (!target && want === 'todo' && currentKind !== 'todo') cv[c.status.id] = '';
      else if (!target && values.statusName && labelKey(values.statusName) !== labelKey(current)) notes.push(`${c.status.title} in ${LABEL} has no label “${values.statusName}”, so it stayed “${current || 'blank'}”.`);
    } else {
      const groups = board.groups ?? [];
      const named = values.statusName ? groups.find((g) => labelKey(g.title) === labelKey(values.statusName!)) : undefined;
      const byKind = !named && want && want !== mondayCategory(item.group?.title ?? null, false) ? groups.find((g) => mondayCategory(g.title, false) === want) : undefined;
      group = named ?? byKind ?? null;
      if (group && group.id === item.group?.id) group = null;
      if (!named && !byKind && values.statusName && labelKey(values.statusName) !== labelKey(item.group?.title ?? '')) notes.push(`Board “${board.name ?? board.id}” has no group “${values.statusName}” in ${LABEL}, so the item stayed in ${item.group?.title ?? 'its group'}.`);
    }
  }
  for (const [id, v] of Object.entries(values.custom ?? {})) {
    const m = mapOf(conn).find((x) => x.tracker === id);
    if (!m || v === undefined) continue;
    const col = board.columns?.find((x) => x.id === id);
    if (!col) {
      notes.push(`Board “${board.name ?? board.id}” has no column ${m.trackerName || id} in ${LABEL}, so it wasn’t sent.`);
      continue;
    }
    let personId: string | null = null;
    if (m.type === 'person' && typeof v === 'string' && v) {
      if (v.startsWith('~')) continue;
      personId = await userIdByEmail(conn, v);
      if (!personId) {
        notes.push(`No one in ${LABEL} has the address ${v}, so ${m.trackerName || id} wasn’t sent.`);
        continue;
      }
    }
    cv[id] = columnWrite(col, v, personId);
  }
  if (Object.keys(cv).length)
    await gql(conn, 'mutation ($item: ID!, $board: ID!, $values: JSON!) { change_multiple_column_values (item_id: $item, board_id: $board, column_values: $values) { id } }', { item: item.id, board: board.id, values: JSON.stringify(cv) }, 'change the item');
  if (group) await gql(conn, 'mutation ($item: ID!, $group: String!) { move_item_to_group (item_id: $item, group_id: $group) { id } }', { item: item.id, group: group.id }, `move the item to ${group.title}`);
  if (values.description !== undefined) {
    const mine = descriptionUpdate(item, conn.settings.accountId);
    const body = markdownToHtml(values.description);
    if (mine && conn.settings.accountId && String(mine.creator?.id ?? '') === String(conn.settings.accountId))
      await gql(conn, 'mutation ($id: ID!, $body: String!) { edit_update (id: $id, body: $body) { id } }', { id: mine.id, body }, 'change the description');
    else if (values.description.trim()) await gql(conn, 'mutation ($item: ID!, $body: String!) { create_update (item_id: $item, body: $body) { id } }', { item: item.id, body }, 'write the description');
  }
  return notes;
}

const itemOfUrl = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.searchParams.get('item') ?? u.searchParams.get('el');
  } catch {
    return null;
  }
};

const WEBHOOK_EVENTS = ['change_column_value', 'change_name', 'create_update', 'edit_update', 'item_moved_to_any_group', 'item_deleted'];

export const monday: TrackerProvider = {
  kind: 'monday',
  fields: ['title', 'description', 'status', 'statusName', 'assignee', 'startDate', 'dueDate'],
  queryLanguage: 'Filter',
  parents: { issueType: null },

  authHeaders(creds: Credentials) {
    // monday.com takes the token itself (API tokens and OAuth access tokens alike).
    return { authorization: creds.kind === 'oauth' ? creds.accessToken : creds.token };
  },

  async whoAmI(conn) {
    const d = await gql<{ me?: { id: string | number; name?: string; email?: string; account?: { slug?: string } | null } }>(conn, 'query { me { id name email account { slug } } }', {}, 'say who the connection is');
    const me = d.me;
    if (!me) throw new TrackerError(`${LABEL} didn’t say who the connection is.`, 'auth', 401);
    const slug = me.account?.slug;
    // Item links go to the account's own address when the connection is monday.com itself.
    const hosted = /^https:\/\/([a-z0-9-]+\.)?monday\.com$/i.test(conn.site);
    return { account: me.email ?? me.name ?? 'monday.com user', settings: { accountId: String(me.id), accountUrl: hosted && slug && /^[a-z0-9-]{1,63}$/i.test(slug) ? `https://${slug}.monday.com` : null } };
  },

  async listProjects(conn) {
    const d = await gql<{ boards?: Array<Board & { workspace?: { name?: string } | null }> }>(conn, 'query { boards (limit: 200, state: active) { id name type workspace { name } } }', {}, 'list boards');
    return (d.boards ?? [])
      .filter((b) => (b.type ?? 'board') === 'board')
      .map((b) => ({ id: String(b.id), key: String(b.id), name: b.name ?? String(b.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async listFields(conn) {
    const d = await gql<{ boards?: Board[] }>(conn, 'query { boards (limit: 50, state: active) { id name type columns { id title type } } }', {}, 'list its columns');
    const kinds: Record<string, MappedFieldType> = { text: 'text', long_text: 'text', numbers: 'number', date: 'date', status: 'select', dropdown: 'multiselect', people: 'person' };
    const seen = new Map<string, TrackerFieldInfo>();
    for (const b of d.boards ?? []) {
      if ((b.type ?? 'board') !== 'board') continue;
      const own = columnsOf(b);
      for (const col of b.columns ?? []) {
        if (col.id === 'name' || [own.status, own.people, own.date, own.timeline].some((x) => x?.id === col.id)) continue;
        const known = seen.get(col.id);
        if (known) {
          if (!known.name.split(' / ').includes(col.title)) known.name = `${known.name} / ${col.title}`.slice(0, 120);
        } else seen.set(col.id, { id: col.id, name: col.title, type: kinds[col.type] ?? null });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  },

  async getIssue(conn, id) {
    const item = await readItem(conn, id);
    return item ? (await toRemotes(conn, [item]))[0] : null;
  },

  async createIssue(conn, input: CreateIssueInput) {
    const notes: string[] = [];
    const v = input.values;
    const name = (v.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 255) || 'Untitled';
    let id: string;
    if (input.parent) {
      const parent = input.parent.replace(/^#/, '').trim();
      if (!ID.test(parent)) throw new TrackerError(`${input.parent} isn’t a ${LABEL} item.`, 'invalid', 400);
      const d = await gql<{ create_subitem?: { id: string } }>(conn, 'mutation ($parent: ID!, $name: String!) { create_subitem (parent_item_id: $parent, item_name: $name) { id } }', { parent, name }, `create a subitem of ${parent}`);
      id = String(d.create_subitem?.id ?? '');
    } else {
      if (!ID.test(input.project)) throw new TrackerError(`${input.project} isn’t a ${LABEL} board.`, 'invalid', 400);
      const d = await gql<{ create_item?: { id: string } }>(conn, 'mutation ($board: ID!, $name: String!) { create_item (board_id: $board, item_name: $name) { id } }', { board: input.project, name }, `create an item on board ${input.project}`);
      id = String(d.create_item?.id ?? '');
    }
    if (!ID.test(id)) throw new TrackerError(`${LABEL} didn’t say which item it made.`, 'invalid', 502);
    // Everything else as an edit of the new item, on its own board (a subitem's is its own).
    const { title: _t, ...rest } = v;
    let item = await readItem(conn, id);
    if (item && Object.keys(rest).length) {
      notes.push(...(await write(conn, item, { ...rest, ...(rest.assignee === null ? { assignee: undefined } : {}) }, item.board ?? (await readBoard(conn, input.project)))));
      item = (await readItem(conn, id)) ?? item;
    }
    if (!item) throw new TrackerError(`${LABEL} lost the item it just made.`, 'invalid', 502);
    return { issue: (await toRemotes(conn, [item]))[0], notes };
  },

  async updateIssue(conn, issue, patch) {
    // Read now for what a write needs (the board's columns, the description update); the write
    // names only the columns this sync changes, so what someone else changed meanwhile stays.
    const item = await readItem(conn, issue.id);
    if (!item) throw new TrackerError(`Item ${issue.key} no longer exists in ${LABEL}.`, 'not_found', 404);
    return write(conn, item, patch, item.board ?? (await readBoard(conn, issue.project ?? '')));
  },

  async search(conn, query, limit) {
    const f = parseMondayFilter(query);
    const ref = f.board || conn.settings.project || null;
    if (!ref) throw new TrackerError(`Name a board (board:<name>) to import from ${LABEL}.`, 'invalid', 400);
    const board = ID.test(ref) ? ref : (await monday.listProjects(conn)).find((p) => labelKey(p.name) === labelKey(ref))?.key;
    if (!board) throw new TrackerError(`${LABEL} has no board “${ref}” this connection can see.`, 'invalid', 400);
    const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
    const me = f.assignee === 'me' ? (conn.settings.account ?? '').toLowerCase() : f.assignee;
    const items = (await boardItems(conn, board, 500)).filter((i) => !f.group || labelKey(i.group?.title ?? '') === labelKey(f.group));
    return (await toRemotes(conn, items))
      .filter((i) => (!f.status || labelKey(i.values.statusName ?? '') === labelKey(f.status)) && (!me || i.values.assignee === me) && words.every((w) => i.values.title.toLowerCase().includes(w)))
      .slice(0, limit);
  },

  async scoped(conn, scope, limit) {
    if (scope.epic) {
      const parent = scope.epic.replace(/^#/, '').trim();
      if (!ID.test(parent)) throw new TrackerError(`${scope.epic} isn’t a ${LABEL} item.`, 'invalid', 400);
      const d = await gql<{ items?: Array<{ subitems?: Item[] }> }>(conn, `query ($ids: [ID!]) { items (ids: $ids) { subitems { ${ITEM} } } }`, { ids: [parent] }, 'list the subitems');
      return toRemotes(conn, (d.items?.[0]?.subitems ?? []).slice(0, limit));
    }
    const ref = scope.project;
    const board = ID.test(ref) ? ref : (await monday.listProjects(conn)).find((p) => labelKey(p.name) === labelKey(ref))?.key;
    if (!board) throw new TrackerError(`${LABEL} has no board “${ref}” this connection can see.`, 'invalid', 400);
    return toRemotes(conn, await boardItems(conn, board, limit));
  },

  async changedSince(conn, issues, since) {
    const ids = issues.map((i) => i.id).filter((id) => ID.test(id));
    const out: string[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const d = await gql<{ items?: Array<{ id: string | number; updated_at?: string }> }>(conn, 'query ($ids: [ID!]) { items (ids: $ids) { id updated_at } }', { ids: ids.slice(i, i + 100) }, 'check what changed');
      for (const it of d.items ?? []) if ((Date.parse(it.updated_at ?? '') || 0) >= since) out.push(String(it.id));
    }
    return out;
  },

  async setBacklinks(conn, issue, links: Backlink[], removed) {
    const item = await readItem(conn, issue.id);
    if (!item) throw new TrackerError(`Item ${issue.key} no longer exists in ${LABEL}.`, 'not_found', 404);
    const mine = linksUpdate(item, conn.settings.accountId);
    const kept = links.filter((l) => !removed.includes(itemOfUrl(l.url) ?? ''));
    if (!kept.length) {
      if (mine) await gql(conn, 'mutation ($id: ID!) { delete_update (id: $id) { id } }', { id: mine.id }, 'remove the links back to the board');
      return;
    }
    const body = markdownToHtml([LINKS_MARK, '', ...kept.map((l) => `- [${l.title.replace(/[[\]]/g, '')}](${l.url})`)].join('\n'));
    if (mine) {
      if (mine.body !== body) await gql(conn, 'mutation ($id: ID!, $body: String!) { edit_update (id: $id, body: $body) { id } }', { id: mine.id, body }, `link ${issue.key} back to the board`);
    } else await gql(conn, 'mutation ($item: ID!, $body: String!) { create_update (item_id: $item, body: $body) { id } }', { item: item.id, body }, `link ${issue.key} back to the board`);
  },

  label: (tag) => tag.trim().slice(0, 100),

  webhooks: {
    signed: false,
    async register(conn, project, address) {
      if (!ID.test(project)) throw new TrackerError(`${project} isn’t a ${LABEL} board.`, 'invalid', 400);
      // One per event; monday.com posts a challenge to `address` before each answer.
      const ids: string[] = [];
      for (const event of WEBHOOK_EVENTS) {
        const d = await gql<{ create_webhook?: { id: string | number } }>(conn, 'mutation ($board: ID!, $url: String!, $event: WebhookEventType!) { create_webhook (board_id: $board, url: $url, event: $event) { id } }', { board: project, url: address, event }, `watch board ${project}`);
        if (d.create_webhook?.id !== undefined) ids.push(String(d.create_webhook.id));
      }
      return { id: ids.join(',') };
    },
    async unregister(conn, id) {
      for (const one of id.split(',').filter((x) => ID.test(x)))
        await gql(conn, 'mutation ($id: ID!) { delete_webhook (id: $id) { id } }', { id: one }, 'stop a webhook').catch((e) => {
          if (!(e instanceof TrackerError) || e.kind !== 'invalid') throw e;
        });
    },
  },

  webhook(d: WebhookDelivery) {
    // Only webhooks Freero registered (the service checked the address's key before this).
    if (!d.hook) return null;
    let body: { challenge?: unknown; event?: { pulseId?: unknown; itemId?: unknown; parentItemId?: unknown } } | null = null;
    try {
      body = JSON.parse(d.rawBody.toString('utf8'));
    } catch {
      return { issues: [] };
    }
    if (body && typeof body.challenge === 'string') {
      // The handshake: echoed only while Freero is registering this webhook.
      if (!d.hook.pending || body.challenge.length > 1000) return null;
      return { issues: [], handshake: { body: { challenge: body.challenge } } };
    }
    const e = body?.event ?? {};
    const issues = [e.pulseId, e.itemId, e.parentItemId].filter((x) => typeof x === 'number' || (typeof x === 'string' && ID.test(x))).map(String);
    return { issues: [...new Set(issues)] };
  },
};

// ---- OAuth (the operator's monday.com app; its tokens don't expire) ----

export const mondayOAuth: OAuthProvider = {
  kind: 'monday',
  authorizeUrl({ clientId, redirectUri, state }) {
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, scope: 'me:read boards:read boards:write users:read updates:read updates:write webhooks:write' });
    return `${getConfig().trackers.mondayAuthUrl}/oauth2/authorize?${q}`;
  },
  async redeem({ clientId, clientSecret, redirectUri, code }) {
    const res = await trackerRequest(
      { method: 'POST', url: `${getConfig().trackers.mondayAuthUrl}/oauth2/token`, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code }) },
      { allowPrivate: getConfig().trackers.privateEndpoints },
    );
    const j = res.json as { access_token?: string } | null;
    if (!ok(res) || !j?.access_token) throw new TrackerError(`${LABEL} refused the authorization${trackerMessage(res.json) ? `: ${trackerMessage(res.json)}` : '.'}`, 'auth', res.status || 401);
    return { credentials: { kind: 'oauth', accessToken: j.access_token, refreshToken: null, expiresAt: null }, sites: [{ site: 'https://monday.com', apiBase: getConfig().trackers.mondayApiUrl, name: LABEL }] };
  },
  async refresh() {
    throw new TrackerError(`${LABEL}’s authorization ended: connect it again.`, 'auth', 401);
  },
};
