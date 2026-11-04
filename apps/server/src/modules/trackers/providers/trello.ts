// Trello (#181), through its public REST API (https://api.trello.com/1) with an API key and a token
// (`Authorization: OAuth oauth_consumer_key="…", oauth_token="…"`). Cards are the issues; a
// "project" is a board (its id), and the column a card stands in is its list, by name.
//
//   Fields     name, the Markdown description (`desc`), members (the card's first member is its
//              assignee: Trello hides members' addresses, so a member is matched to a Freero person
//              by the Trello username of the personal Trello connection they made, else stays
//              "~username"), list ↔ column, start and due dates, labels by name (made on the board
//              when missing), mapped custom fields (#43: text, number, date, drop-down) by id.
//              A list's name says where a card stands (Doing, Review… → in progress; Done… → done).
//   Writes     only the fields that changed: a PUT names only those, members and labels are added /
//              removed one by one, a custom field is its own call.
//   Backlinks  URL attachments, one per board item (found again by their URL).
//   Inbound    webhooks Freero registers per board (`webhooks`): Trello checks the address with a
//              HEAD request before it makes one. With the key's secret (the operator's, or one given
//              with the connection) every delivery's X-Trello-Webhook signature (HMAC-SHA1 of body +
//              address) is checked; without it, the address's key is the credential. Polling
//              (`dateLastActivity`, ten cards per batch call) catches what a lost delivery missed.
import { createHmac, timingSafeEqual } from 'node:crypto';
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
import { trackerMessage, TrackerError, type HttpResponse } from '../http';
import type { Backlink, CreateIssueInput, Credentials, ProviderConnection, RemoteIssue, TrackerProvider, WebhookDelivery } from './types';

const LABEL = TRACKER_PROVIDERS.trello;
/** Trello ids: 24 hex digits. */
const ID = /^[0-9a-f]{24}$/i;

interface Member {
  id: string;
  username?: string;
  fullName?: string;
}

interface CustomFieldDef {
  id: string;
  name?: string;
  type?: 'text' | 'number' | 'date' | 'checkbox' | 'list';
  options?: Array<{ id: string; value?: { text?: string } }>;
}

export interface TrelloCard {
  id: string;
  idShort?: number;
  name?: string;
  desc?: string;
  closed?: boolean;
  idList?: string;
  idBoard?: string;
  idMembers?: string[];
  members?: Member[];
  start?: string | null;
  due?: string | null;
  labels?: Array<{ id: string; name?: string; color?: string | null }>;
  dateLastActivity?: string;
  shortUrl?: string;
  url?: string;
  list?: { id: string; name?: string };
  board?: { id: string; name?: string };
  customFieldItems?: Array<{ idCustomField: string; value?: { text?: string; number?: string; date?: string; checked?: string } | null; idValue?: string | null }>;
}

const ok = (res: HttpResponse) => res.status >= 200 && res.status < 300;
const seg = (s: string) => encodeURIComponent(s);
const mapOf = (conn: ProviderConnection): FieldMapEntry[] => conn.settings.fieldMap ?? [];

/** Trello's answer in Freero's words (it often answers in plain text). */
function refused(res: HttpResponse, what: string): TrackerError {
  const said = trackerMessage(res.json) ?? (res.text && res.text.length < 200 ? res.text.trim() : null);
  if (res.status === 401) return new TrackerError(`${LABEL} refused the credentials. Check the connection’s API key and token.`, 'auth', 401);
  if (res.status === 403) return new TrackerError(`${LABEL} doesn’t allow this connection to ${what}${said ? ` (${said.slice(0, 200)})` : ''}.`, 'refused', 403);
  if (res.status === 404) return new TrackerError(`${LABEL} couldn’t find what Freero asked for (${what}).`, 'not_found', 404);
  return new TrackerError(`${LABEL} refused to ${what}${said ? `: ${said.slice(0, 300)}` : ` (${res.status})`}.`, 'invalid', res.status);
}

async function api<T>(conn: ProviderConnection, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, what: string, body?: unknown): Promise<T> {
  const res = await conn.call({ method, path, ...(body !== undefined ? { body } : {}) });
  if (!ok(res)) throw refused(res, what);
  return res.json as T;
}

// ---- reading ----

const DONE = /\b(done|complete(d)?|closed|shipped|released|resolved|finished)\b/i;
const DOING = /\b(doing|in progress|progress|review|reviewing|active|working|started|wip|testing|qa|blocked)\b/i;

/** Where a card stands, from its list's name (to do by default). */
export function trelloCategory(list: string | null): IssueStatusCategory {
  if (list && DONE.test(list)) return 'done';
  if (list && DOING.test(list)) return 'doing';
  return 'todo';
}

const CARD_FIELDS = 'fields=name,desc,closed,idList,idBoard,idMembers,start,due,labels,dateLastActivity,shortUrl,url,idShort&members=true&member_fields=username,fullName&list=true&list_fields=name&board=true&board_fields=name&customFieldItems=true';

/** A member as the board reads them: a Freero person's address (through their own Trello connection), else "~username". */
async function personOf(conn: ProviderConnection, m: Member | undefined): Promise<string | null> {
  if (!m) return null;
  const login = m.username ?? m.id;
  return (await conn.people?.emailOf(login).catch(() => null)) ?? `~${login}`;
}

const dayOf = (iso: string | null | undefined): string | null => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(Date.parse(iso)).toISOString().slice(0, 10) : null);
/** A board day as Trello's midday of that day (UTC), so no time zone moves it to another day. */
const isoOf = (day: string | null): string | null => (day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T12:00:00.000Z` : null);

async function fieldDefs(conn: ProviderConnection, board: string): Promise<CustomFieldDef[]> {
  return (await api<CustomFieldDef[] | null>(conn, 'GET', `/boards/${seg(board)}/customFields`, 'list the board’s custom fields')) ?? [];
}

function customOf(type: MappedFieldType, def: CustomFieldDef | undefined, item: NonNullable<TrelloCard['customFieldItems']>[number] | undefined): CustomValue | undefined {
  if (!def) return undefined;
  if (!item) return type === 'multiselect' ? [] : null;
  switch (type) {
    case 'select':
      return def.options?.find((o) => o.id === item.idValue)?.value?.text ?? null;
    case 'number':
      return item.value?.number !== undefined && Number.isFinite(Number(item.value.number)) ? Number(item.value.number) : null;
    case 'date':
      return dayOf(item.value?.date);
    case 'text':
      return item.value?.text ?? null;
    default:
      return null;
  }
}

export async function trelloToRemote(conn: ProviderConnection, c: TrelloCard, defs: CustomFieldDef[] | null = null): Promise<RemoteIssue> {
  const listName = c.list?.name ?? null;
  const first = c.members?.find((m) => m.id === c.idMembers?.[0]) ?? c.members?.[0];
  const map = mapOf(conn);
  let custom: Record<string, CustomValue> | null = null;
  if (map.length && c.idBoard) {
    const all = defs ?? (await fieldDefs(conn, c.idBoard).catch(() => []));
    custom = Object.fromEntries(
      map.flatMap((e) => {
        const v = customOf(e.type, all.find((d) => d.id === e.tracker), c.customFieldItems?.find((i) => i.idCustomField === e.tracker));
        return v === undefined ? [] : [[e.tracker, v]];
      }),
    );
  }
  return {
    id: c.id,
    key: c.idShort !== undefined ? `#${c.idShort}` : c.id,
    url: c.shortUrl && /^https:\/\//.test(c.shortUrl) ? c.shortUrl : `${conn.site.replace(/\/+$/, '')}/c/${seg(c.id)}`,
    values: {
      title: c.name ?? '',
      description: (c.desc ?? '').trim(),
      status: trelloCategory(listName),
      statusName: listName,
      assignee: await personOf(conn, first),
      labels: (c.labels ?? []).map((l) => l.name ?? '').filter(Boolean),
      startDate: dayOf(c.start),
      dueDate: dayOf(c.due),
      ...(custom ? { custom } : {}),
    },
    assigneeName: first ? (first.fullName ?? first.username ?? null) : null,
    updatedAt: c.dateLastActivity ? Date.parse(c.dateLastActivity) || 0 : 0,
    groups: { team: c.board?.name ?? null, epic: null },
    project: c.idBoard ?? null,
  };
}

async function getCard(conn: ProviderConnection, id: string): Promise<TrelloCard | null> {
  if (!ID.test(id)) return null;
  const res = await conn.call({ method: 'GET', path: `/cards/${seg(id)}?${CARD_FIELDS}` });
  if (res.status === 404 || res.status === 400) return null;
  if (!ok(res)) throw refused(res, 'read the card');
  return res.json as TrelloCard;
}

async function boardCards(conn: ProviderConnection, board: string, limit: number): Promise<RemoteIssue[]> {
  if (!ID.test(board)) throw new TrackerError(`${board} isn’t a ${LABEL} board.`, 'invalid', 400);
  const cards = (await api<TrelloCard[]>(conn, 'GET', `/boards/${seg(board)}/cards/open?${CARD_FIELDS}`, `list the cards of board ${board}`)) ?? [];
  // A board's cards come without their list's name: the board's lists say it.
  const lists = new Map((await listsOf(conn, board)).map((l) => [l.id, l.name]));
  const defs = mapOf(conn).length ? await fieldDefs(conn, board).catch(() => []) : [];
  const out: RemoteIssue[] = [];
  for (const c of cards.slice(0, limit)) out.push(await trelloToRemote(conn, { ...c, list: c.list ?? (c.idList ? { id: c.idList, name: lists.get(c.idList) } : undefined) }, defs));
  return out;
}

/** A card's id from what people paste: the id, or its address (…/c/<shortLink>) when Trello resolves it. */
export function trelloCardRef(s: string): string | null {
  const t = s.trim();
  if (ID.test(t)) return t;
  const m = /\/c\/([A-Za-z0-9]{8})(?:\/|$)/.exec(t);
  return m ? m[1] : null;
}

// ---- the filter people type to import ----

/** `board:<id or name> list:"Doing" member:me label:web words…` → its parts. */
export function parseTrelloFilter(q: string): { board?: string; list?: string; member?: string; label?: string; done?: boolean; text: string } {
  const out: { board?: string; list?: string; member?: string; label?: string; done?: boolean; text: string } = { text: '' };
  const rest: string[] = [];
  for (const m of q.matchAll(/(\w+):(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g)) {
    const key = m[1]?.toLowerCase();
    const value = (m[2] ?? m[3] ?? '').trim();
    if (key === 'board' || key === 'project') out.board = value;
    else if (key === 'list' || key === 'column') out.list = value;
    else if (key === 'member' || key === 'assignee') out.member = value.toLowerCase();
    else if (key === 'label' || key === 'tag') out.label = value;
    else if (key === 'done') out.done = /^(yes|true|1)$/i.test(value);
    else rest.push(m[4] ?? m[5] ?? m[0]);
  }
  out.text = rest.join(' ').trim();
  return out;
}

async function boardNamed(conn: ProviderConnection, nameOrId: string): Promise<string> {
  if (ID.test(nameOrId)) return nameOrId;
  const hit = (await trello.listProjects(conn)).find((p) => labelKey(p.name) === labelKey(nameOrId));
  if (!hit) throw new TrackerError(`${LABEL} has no board “${nameOrId}” this connection can see.`, 'invalid', 400);
  return hit.key;
}

// ---- writing ----

const TTL_MS = 60_000;
const listsCache = new Map<string, { at: number; lists: Array<{ id: string; name: string }> }>();

async function listsOf(conn: ProviderConnection, board: string): Promise<Array<{ id: string; name: string }>> {
  const key = `${conn.id}\n${board}`;
  const hit = listsCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.lists;
  const lists = ((await api<Array<{ id: string; name?: string }>>(conn, 'GET', `/boards/${seg(board)}/lists?filter=open&fields=name`, `list the lists of board ${board}`)) ?? []).map((l) => ({ id: l.id, name: l.name ?? '' }));
  listsCache.set(key, { at: Date.now(), lists });
  return lists;
}

/** The board member a Freero person is (their own Trello connection's username), or null. */
async function memberFor(conn: ProviderConnection, board: string, email: string): Promise<Member | null> {
  const login = await conn.people?.loginOf(email).catch(() => null);
  if (!login) return null;
  const members = (await api<Member[]>(conn, 'GET', `/boards/${seg(board)}/members?fields=username,fullName`, 'list the board’s members')) ?? [];
  return members.find((m) => (m.username ?? '').toLowerCase() === login.toLowerCase()) ?? null;
}

/** Writes `values` (only those present) onto card `c`; returns notes for what couldn't be written. */
async function write(conn: ProviderConnection, c: TrelloCard, values: IssueValues): Promise<string[]> {
  const notes: string[] = [];
  const data: Record<string, unknown> = {};
  const board = c.idBoard ?? '';
  if (values.title !== undefined) data.name = values.title.replace(/\s+/g, ' ').trim().slice(0, 16384) || 'Untitled';
  if (values.description !== undefined) data.desc = values.description.slice(0, 16384);
  if (values.dueDate !== undefined) data.due = isoOf(values.dueDate);
  if (values.startDate !== undefined) data.start = isoOf(values.startDate);
  if ((values.statusName !== undefined || values.status !== undefined) && board) {
    const lists = await listsOf(conn, board);
    const current = lists.find((l) => l.id === c.idList)?.name ?? c.list?.name ?? '';
    const want = values.status ?? null;
    const named = values.statusName ? lists.find((l) => labelKey(l.name) === labelKey(values.statusName!)) : undefined;
    const byKind = !named && want && want !== trelloCategory(current) ? lists.find((l) => trelloCategory(l.name) === want) : undefined;
    const target = named ?? byKind;
    if (target && target.id !== c.idList) data.idList = target.id;
    else if (!target && values.statusName && labelKey(values.statusName) !== labelKey(current)) notes.push(`The board has no list “${values.statusName}” in ${LABEL}, so the card stayed in ${current || 'its list'}.`);
  }
  if (Object.keys(data).length) await api(conn, 'PUT', `/cards/${seg(c.id)}`, 'change the card', data);

  if (values.assignee !== undefined && board) {
    // The card has one assignee: it becomes the card's first member; the other members stay.
    const first = c.idMembers?.[0] ?? null;
    if (values.assignee === null) {
      if (first) await api(conn, 'DELETE', `/cards/${seg(c.id)}/idMembers/${seg(first)}`, 'remove a member');
    } else if (!values.assignee.startsWith('~')) {
      const m = await memberFor(conn, board, values.assignee);
      if (!m) notes.push(`${LABEL} doesn’t show members’ addresses: ${values.assignee} becomes a member once they connect their own ${LABEL} account to Freero (Settings → Your issue trackers) and are on the board.`);
      else if (!c.idMembers?.includes(m.id)) {
        await api(conn, 'POST', `/cards/${seg(c.id)}/idMembers?value=${seg(m.id)}`, 'add a member');
        if (first) await api(conn, 'DELETE', `/cards/${seg(c.id)}/idMembers/${seg(first)}`, 'remove a member');
      }
    }
  }

  if (values.labels !== undefined && board) {
    const have = new Map((c.labels ?? []).filter((l) => l.name).map((l) => [labelKey(l.name!), l.id]));
    const want = new Map(values.labels.map((l) => [labelKey(trello.label(l)), trello.label(l)]));
    let boardLabels: Array<{ id: string; name?: string }> | null = null;
    for (const [key, name] of want) {
      if (have.has(key)) continue;
      boardLabels ??= (await api<Array<{ id: string; name?: string }>>(conn, 'GET', `/boards/${seg(board)}/labels?fields=name&limit=1000`, 'list the board’s labels')) ?? [];
      let id = boardLabels.find((l) => labelKey(l.name ?? '') === key)?.id;
      if (!id) {
        id = (await api<{ id: string }>(conn, 'POST', '/labels', `make the label “${name}”`, { name, color: null, idBoard: board })).id;
        boardLabels.push({ id, name });
      }
      await api(conn, 'POST', `/cards/${seg(c.id)}/idLabels?value=${seg(id)}`, `label the card “${name}”`);
    }
    for (const [key, id] of have) if (!want.has(key)) await api(conn, 'DELETE', `/cards/${seg(c.id)}/idLabels/${seg(id)}`, 'remove a label');
  }

  const custom = Object.entries(values.custom ?? {});
  if (custom.length && board) {
    const defs = await fieldDefs(conn, board);
    for (const [id, v] of custom) {
      const e = mapOf(conn).find((m) => m.tracker === id);
      if (!e || v === undefined) continue;
      const def = defs.find((d) => d.id === id);
      if (!def) {
        notes.push(`${e.trackerName || id} isn’t one of this board’s custom fields in ${LABEL}, so it wasn’t sent.`);
        continue;
      }
      let body: unknown;
      if (v === null || v === '' || (Array.isArray(v) && !v.length)) body = def.type === 'list' ? { idValue: '' } : { value: '' };
      else if (def.type === 'list') {
        const opt = def.options?.find((o) => labelKey(o.value?.text ?? '') === labelKey(String(v)));
        if (!opt) {
          notes.push(`${e.trackerName || id} in ${LABEL} has no option “${v}”, so it wasn’t sent.`);
          continue;
        }
        body = { idValue: opt.id };
      } else if (def.type === 'number') body = { value: { number: String(v) } };
      else if (def.type === 'date') body = { value: { date: isoOf(String(v)) } };
      else body = { value: { text: String(v) } };
      await api(conn, 'PUT', `/cards/${seg(c.id)}/customField/${seg(id)}/item`, `set ${e.trackerName || id}`, body);
    }
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

const header = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const quoted = (s: string) => s.replace(/[\\"]/g, '');

export const trello: TrackerProvider = {
  kind: 'trello',
  fields: ['title', 'description', 'status', 'statusName', 'assignee', 'labels', 'startDate', 'dueDate'],
  queryLanguage: 'Filter',

  authHeaders(creds: Credentials) {
    const key = creds.kind === 'token' ? (creds.key ?? '') : '';
    const token = creds.kind === 'oauth' ? creds.accessToken : creds.token;
    return { authorization: `OAuth oauth_consumer_key="${quoted(key)}", oauth_token="${quoted(token)}"` };
  },

  async whoAmI(conn) {
    const me = await api<{ id: string; username?: string; fullName?: string; email?: string | null }>(conn, 'GET', '/members/me?fields=username,fullName,email', 'say who the connection is');
    return { account: me.email ?? me.username ?? 'Trello member', settings: { accountId: me.id, login: me.username ?? null } };
  },

  async listProjects(conn) {
    const boards = (await api<Array<{ id: string; name?: string }>>(conn, 'GET', '/members/me/boards?filter=open&fields=name', 'list its boards')) ?? [];
    return boards.map((b) => ({ id: b.id, key: b.id, name: b.name ?? b.id })).sort((a, b) => a.name.localeCompare(b.name));
  },

  async listFields(conn) {
    const board = conn.settings.project;
    if (!board || !ID.test(board)) return [];
    const kinds: Record<string, MappedFieldType> = { text: 'text', number: 'number', date: 'date', list: 'select' };
    return (await fieldDefs(conn, board))
      .filter((f) => f.name)
      .map((f): TrackerFieldInfo => ({ id: f.id, name: f.name!, type: kinds[f.type ?? ''] ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async getIssue(conn, id) {
    const c = await getCard(conn, id);
    return c ? trelloToRemote(conn, c) : null;
  },

  async createIssue(conn, input: CreateIssueInput) {
    if (!ID.test(input.project)) throw new TrackerError(`${input.project} isn’t a ${LABEL} board.`, 'invalid', 400);
    const v = input.values;
    const lists = await listsOf(conn, input.project);
    // The list named like the card's column, else the first of its kind, else the board's first.
    const list = (v.statusName ? lists.find((l) => labelKey(l.name) === labelKey(v.statusName!)) : undefined) ?? (v.status ? lists.find((l) => trelloCategory(l.name) === v.status) : undefined) ?? lists[0];
    if (!list) throw new TrackerError(`The ${LABEL} board has no open list to put the card in.`, 'invalid', 400);
    const made = await api<TrelloCard>(conn, 'POST', '/cards', `create a card on board ${input.project}`, {
      idList: list.id,
      name: (v.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 16384) || 'Untitled',
      ...(v.description !== undefined ? { desc: v.description.slice(0, 16384) } : {}),
      pos: 'bottom',
    });
    const { title: _t, description: _d, status: _s, statusName: _n, ...rest } = v;
    const notes: string[] = [];
    const fresh = (await getCard(conn, made.id)) ?? made;
    if (Object.keys(rest).length) notes.push(...(await write(conn, fresh, { ...rest, ...(rest.assignee === null ? { assignee: undefined } : {}) })));
    return { issue: await trelloToRemote(conn, (await getCard(conn, made.id)) ?? fresh), notes };
  },

  async updateIssue(conn, issue, patch) {
    // Read now for what a write needs (lists, members, labels); the PUT names only the fields this
    // sync changes, so what someone else changed meanwhile stays.
    const c = await getCard(conn, issue.id);
    if (!c) throw new TrackerError(`${issue.key} no longer exists in ${LABEL}.`, 'not_found', 404);
    return write(conn, c, patch);
  },

  async search(conn, query, limit) {
    const f = parseTrelloFilter(query);
    const ref = f.board || conn.settings.project || null;
    if (!ref) throw new TrackerError(`Name a board (board:<name>) to import from ${LABEL}.`, 'invalid', 400);
    const board = await boardNamed(conn, ref);
    const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
    const me = f.member === 'me' ? (conn.settings.login ?? '').toLowerCase() : f.member;
    const all = await boardCards(conn, board, 1000);
    return all
      .filter(
        (i) =>
          (!f.list || labelKey(i.values.statusName ?? '') === labelKey(f.list)) &&
          (!me || [i.values.assignee ?? '', `~${me}`].includes(me) || (i.values.assignee ?? '').toLowerCase() === `~${me}`) &&
          (!f.label || i.values.labels.some((l) => labelKey(l) === labelKey(f.label!))) &&
          (f.done === undefined || (i.values.status === 'done') === f.done) &&
          words.every((w) => i.values.title.toLowerCase().includes(w)),
      )
      .slice(0, limit);
  },

  async scoped(conn, scope, limit) {
    return boardCards(conn, await boardNamed(conn, scope.project), limit);
  },

  async changedSince(conn, issues, since) {
    const ids = issues.map((i) => i.id).filter((id) => ID.test(id));
    const out: string[] = [];
    // Ten reads per call (Trello's batch API), only the time each was last active.
    for (let i = 0; i < ids.length; i += 10) {
      const urls = ids.slice(i, i + 10).map((id) => `/cards/${id}?fields=dateLastActivity`);
      const answers = (await api<Array<Record<string, { id?: string; dateLastActivity?: string }>>>(conn, 'GET', `/batch?urls=${urls.map(seg).join(',')}`, 'check what changed')) ?? [];
      for (const a of answers) {
        const c = a['200'];
        if (c?.id && (Date.parse(c.dateLastActivity ?? '') || 0) >= since) out.push(c.id);
      }
    }
    return out;
  },

  async setBacklinks(conn, issue, links: Backlink[], removed) {
    const have = (await api<Array<{ id: string; url?: string }>>(conn, 'GET', `/cards/${seg(issue.id)}/attachments?fields=url,name`, `read the attachments of ${issue.key}`)) ?? [];
    for (const a of have) if (a.url && removed.includes(itemOfUrl(a.url) ?? '')) await api(conn, 'DELETE', `/cards/${seg(issue.id)}/attachments/${seg(a.id)}`, 'remove a link back to the board');
    const known = new Set(have.map((a) => a.url));
    for (const l of links) if (!known.has(l.url)) await api(conn, 'POST', `/cards/${seg(issue.id)}/attachments`, `link ${issue.key} back to the board`, { url: l.url, name: `On a Freero board: ${l.title}`.slice(0, 256) });
  },

  label: (tag) => tag.trim().slice(0, 100),

  webhooks: {
    signed: false,
    async register(conn, project, address) {
      if (!ID.test(project)) throw new TrackerError(`${project} isn’t a ${LABEL} board.`, 'invalid', 400);
      // Trello sends a HEAD request to `address` before it answers this.
      const made = await api<{ id: string }>(conn, 'POST', '/webhooks', `watch board ${project}`, { callbackURL: address, idModel: project, description: 'Freero' });
      // Deliveries are signed with the API key's secret, when the connection knows it.
      return { id: made.id, ...(conn.signingSecret ? { secret: conn.signingSecret } : {}) };
    },
    async unregister(conn, id) {
      const res = await conn.call({ method: 'DELETE', path: `/webhooks/${seg(id)}` });
      if (!ok(res) && res.status !== 404) throw refused(res, 'stop a webhook');
    },
  },

  webhook(d: WebhookDelivery) {
    // Only webhooks Freero registered (the service checked the address's key). With the key's
    // secret kept for it, the signature over the body and the address must match too.
    if (!d.hook) return null;
    if (d.hook.secret) {
      const given = header(d.headers['x-trello-webhook']);
      if (!given || !d.hook.address) return null;
      const want = createHmac('sha1', d.hook.secret).update(Buffer.concat([d.rawBody, Buffer.from(d.hook.address, 'utf8')])).digest();
      const got = Buffer.from(given, 'base64');
      if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    }
    let body: { action?: { data?: { card?: { id?: unknown } } } } | null = null;
    try {
      body = JSON.parse(d.rawBody.toString('utf8'));
    } catch {
      return { issues: [] };
    }
    const id = body?.action?.data?.card?.id;
    return { issues: typeof id === 'string' && ID.test(id) ? [id] : [] };
  },
};
