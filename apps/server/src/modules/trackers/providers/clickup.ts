// ClickUp (#180), through its public REST API (https://api.clickup.com/api/v2) with a personal
// token (`pk_…`) or the operator's OAuth app. Tasks are the issues; a "project" is a List (its id),
// and the column a card stands in is the task's status in its List (by name; a status of type
// closed / done is done).
//
//   Fields     name, the Markdown description (`markdown_content` written, `markdown_description`
//              read), assignees by email (ClickUp shows its members' addresses; the first is the
//              card's assignee), status ↔ column, priority (Urgent / High / Normal / Low), start and
//              due dates, sprint points as the estimate, tags (made in the Space when missing),
//              mapped custom fields (#43) by id, a parent task (a subtask: `parent` when creating).
//   Writes     only the fields that changed: a PUT names only those (assignees as add / rem, never
//              the whole list), tags are added / removed one by one, a custom field is its own call.
//   Backlinks  one comment by Freero listing the board items, edited when they change.
//   Inbound    webhooks Freero registers per List (`webhooks`): ClickUp hands the webhook's secret
//              back when it is made, and signs every delivery with it (X-Signature, HMAC-SHA256 hex
//              of the body). Polling (the Workspace's tasks updated since, filtered by List) catches
//              what a lost delivery missed.
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
  type TrackerProject,
} from '@freero/shared';
import { getConfig } from '../../../platform/config';
import { trackerMessage, trackerRequest, TrackerError, type HttpResponse } from '../http';
import type { Backlink, CreateIssueInput, Credentials, OAuthProvider, ProviderConnection, RemoteIssue, TrackerProvider, WebhookDelivery } from './types';

const LABEL = TRACKER_PROVIDERS.clickup;
const LINKS_MARK = 'On a Freero board:';
/** ClickUp task and List ids: short alphanumerics ("86a1b2c3d", "901234567"). */
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'] as const;

interface Member {
  id: number | string;
  username?: string | null;
  email?: string | null;
}

interface Field {
  id: string;
  name?: string;
  type?: string;
  value?: unknown;
  type_config?: { options?: Array<{ id: string; name?: string; label?: string; orderindex?: number }> };
}

export interface ClickUpTask {
  id: string;
  custom_id?: string | null;
  name?: string;
  description?: string | null;
  text_content?: string | null;
  markdown_description?: string | null;
  status?: { status?: string; type?: string } | null;
  date_updated?: string | null;
  assignees?: Member[];
  tags?: Array<{ name?: string }>;
  due_date?: string | null;
  start_date?: string | null;
  points?: number | null;
  priority?: { id?: string; priority?: string } | null;
  parent?: string | null;
  list?: { id: string; name?: string } | null;
  folder?: { id: string; name?: string } | null;
  space?: { id: string } | null;
  url?: string;
  custom_fields?: Field[];
  /** `task_id` waits on `depends_on` (#50: the latter blocks the former). */
  dependencies?: Array<{ task_id?: string; depends_on?: string; type?: number }>;
  subtasks?: ClickUpTask[];
}

const ok = (res: HttpResponse) => res.status >= 200 && res.status < 300;
const seg = (s: string) => encodeURIComponent(s);
const mapOf = (conn: ProviderConnection): FieldMapEntry[] => conn.settings.fieldMap ?? [];

/** ClickUp's answer in Freero's words. */
function refused(res: HttpResponse, what: string): TrackerError {
  const j = res.json as { err?: string; ECODE?: string } | null;
  const said = j?.err ?? trackerMessage(res.json);
  if (res.status === 401) return new TrackerError(`${LABEL} refused the credentials. Check the connection’s personal token.`, 'auth', 401);
  if (res.status === 403) return new TrackerError(`${LABEL} doesn’t allow this connection to ${what}${said ? ` (${said.slice(0, 200)})` : ''}.`, 'refused', 403);
  if (res.status === 404) return new TrackerError(`${LABEL} couldn’t find what Freero asked for (${what}).`, 'not_found', 404);
  return new TrackerError(`${LABEL} refused to ${what}${said ? `: ${said.slice(0, 300)}` : ` (${res.status})`}.`, 'invalid', res.status);
}

async function api<T>(conn: ProviderConnection, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, what: string, body?: unknown): Promise<T> {
  const res = await conn.call({ method, path, ...(body !== undefined ? { body } : {}) });
  if (!ok(res)) throw refused(res, what);
  return (res.json ?? {}) as T;
}

// ---- reading ----

const DONE = /\b(done|complete(d)?|closed|shipped|released|resolved)\b/i;
const DOING = /\b(doing|in progress|progress|review|active|working|started|wip|testing|qa|blocked)\b/i;

/** Where a task stands: done for a closed / done status, else what its type and name say. */
export function clickupCategory(status: ClickUpTask['status']): IssueStatusCategory {
  const type = (status?.type ?? '').toLowerCase();
  const name = status?.status ?? '';
  if (type === 'closed' || type === 'done' || DONE.test(name)) return 'done';
  if (type === 'open') return 'todo';
  return DOING.test(name) || type === 'custom' ? 'doing' : 'todo';
}

/** ClickUp keeps dates as Unix milliseconds (strings); the board as days. */
const dayOf = (ms: string | number | null | undefined): string | null => {
  const n = Number(ms);
  return ms === null || ms === undefined || ms === '' || !Number.isFinite(n) ? null : new Date(n).toISOString().slice(0, 10);
};
/** A board day as ClickUp's midday of that day (UTC), so no time zone moves it to another day. */
const msOf = (day: string | null): number | null => (day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T12:00:00Z`) : null);

const emailOf = (m: Member | undefined): string | null => (!m ? null : m.email ? m.email.toLowerCase() : `~${m.username ?? m.id}`);

/** The display name of a priority ("Urgent"), from ClickUp's lowercase one. */
const priorityName = (p: ClickUpTask['priority']): string | null => {
  const n = p?.priority ? PRIORITIES.find((x) => x.toLowerCase() === p.priority!.toLowerCase()) : undefined;
  return n ?? null;
};

function optionLabel(f: Field, v: unknown): string | null {
  const opts = f.type_config?.options ?? [];
  const hit = opts.find((o) => o.id === v || (typeof v === 'number' && o.orderindex === v));
  return hit ? (hit.name ?? hit.label ?? null) : null;
}

function customOf(type: MappedFieldType, f: Field | undefined): CustomValue | undefined {
  if (!f) return undefined;
  const v = f.value;
  switch (type) {
    case 'select':
      return v === null || v === undefined ? null : optionLabel(f, v);
    case 'multiselect':
      return (Array.isArray(v) ? v : []).map((x) => optionLabel(f, x) ?? '').filter(Boolean);
    case 'number':
      return v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
    case 'date':
      return dayOf(v as string | null);
    case 'person':
      return Array.isArray(v) && v.length ? emailOf(v[0] as Member) : null;
    case 'text':
      return typeof v === 'string' ? v : null;
  }
}

export function clickupToRemote(conn: ProviderConnection, t: ClickUpTask): RemoteIssue {
  const fields = new Map((t.custom_fields ?? []).map((f) => [f.id, f]));
  const custom = mapOf(conn).length
    ? Object.fromEntries(
        mapOf(conn).flatMap((e) => {
          const v = customOf(e.type, fields.get(e.tracker));
          return v === undefined ? [] : [[e.tracker, v]];
        }),
      )
    : null;
  const first = t.assignees?.[0];
  return {
    id: t.id,
    key: t.custom_id || t.id,
    url: t.url && /^https?:\/\//.test(t.url) ? t.url : `${conn.site.replace(/\/+$/, '')}/t/${seg(t.id)}`,
    values: {
      title: t.name ?? '',
      description: (t.markdown_description ?? t.text_content ?? t.description ?? '').trim(),
      status: clickupCategory(t.status),
      statusName: t.status?.status ?? null,
      priority: priorityName(t.priority),
      assignee: emailOf(first),
      labels: (t.tags ?? []).map((x) => x.name ?? '').filter(Boolean),
      startDate: dayOf(t.start_date),
      dueDate: dayOf(t.due_date),
      estimate: typeof t.points === 'number' ? t.points : null,
      ...(custom ? { custom } : {}),
    },
    assigneeName: first ? (first.username ?? first.email ?? null) : null,
    updatedAt: Number(t.date_updated) || 0,
    groups: { team: t.folder?.name && t.folder.name !== 'hidden' ? t.folder.name : (t.list?.name ?? null), epic: t.parent ?? null },
    project: t.list?.id ?? null,
    relations: {
      blocks: (t.dependencies ?? []).filter((d) => d.depends_on === t.id && d.task_id).map((d) => d.task_id!),
      blockedBy: (t.dependencies ?? []).filter((d) => d.task_id === t.id && d.depends_on).map((d) => d.depends_on!),
    },
  };
}

const TASK_QUERY = 'include_markdown_description=true';

async function getTask(conn: ProviderConnection, id: string, extra = ''): Promise<ClickUpTask | null> {
  if (!ID.test(id)) return null;
  const res = await conn.call({ method: 'GET', path: `/task/${seg(id)}?${TASK_QUERY}${extra}` });
  // A task gone (or out of the connection's reach): 404, or 401 with an ITEM_ code.
  if (res.status === 404 || (res.status === 401 && /^ITEM_/.test(String((res.json as { ECODE?: string } | null)?.ECODE ?? '')))) return null;
  if (!ok(res)) throw refused(res, 'read the task');
  return res.json as ClickUpTask;
}

/** The tasks of a List (closed ones and subtasks too), up to `limit`. */
async function listTasks(conn: ProviderConnection, list: string, limit: number): Promise<ClickUpTask[]> {
  if (!ID.test(list)) throw new TrackerError(`${list} isn’t a ${LABEL} List.`, 'invalid', 400);
  const out: ClickUpTask[] = [];
  for (let page = 0; out.length < limit && page < 20; page++) {
    const j = await api<{ tasks?: ClickUpTask[]; last_page?: boolean }>(conn, 'GET', `/list/${seg(list)}/task?archived=false&include_closed=true&subtasks=true&${TASK_QUERY}&page=${page}`, `list the tasks of List ${list}`);
    out.push(...(j.tasks ?? []));
    if (j.last_page !== false || !(j.tasks ?? []).length) break;
  }
  return out.slice(0, limit);
}

/** The ClickUp Workspaces (teams) the credentials reach. */
const teamsOf = async (conn: ProviderConnection) => (await api<{ teams?: Array<{ id: string; name?: string }> }>(conn, 'GET', '/team', 'list its Workspaces')).teams ?? [];

/** A task's id from what people paste: the id, or its address (…/t/<id>). */
export function clickupTaskId(s: string): string | null {
  const t = s.trim().replace(/^#/, '');
  if (/^[A-Za-z0-9]{4,40}$/.test(t)) return t;
  const m = /\/t\/(?:\d+\/)?([A-Za-z0-9]{4,40})\/?(?:[?#].*)?$/.exec(t);
  return m ? m[1] : null;
}

// ---- the filter people type to import ----

/** `list:<id or name> status:"In review" assignee:me tag:web done:no words…` → its parts. */
export function parseClickUpFilter(q: string): { list?: string; status?: string; assignee?: string; tag?: string; done?: boolean; text: string } {
  const out: { list?: string; status?: string; assignee?: string; tag?: string; done?: boolean; text: string } = { text: '' };
  const rest: string[] = [];
  for (const m of q.matchAll(/(\w+):(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g)) {
    const key = m[1]?.toLowerCase();
    const value = (m[2] ?? m[3] ?? '').trim();
    if (key === 'list' || key === 'in' || key === 'project') out.list = value;
    else if (key === 'status' || key === 'column') out.status = value;
    else if (key === 'assignee') out.assignee = value.toLowerCase();
    else if (key === 'tag' || key === 'label') out.tag = value;
    else if (key === 'done' || key === 'closed') out.done = /^(yes|true|1)$/i.test(value);
    else rest.push(m[4] ?? m[5] ?? m[0]);
  }
  out.text = rest.join(' ').trim();
  return out;
}

async function listNamed(conn: ProviderConnection, nameOrId: string): Promise<string> {
  if (/^\d{1,30}$/.test(nameOrId)) return nameOrId;
  const want = labelKey(nameOrId);
  const hit = (await clickup.listProjects(conn)).find((p) => labelKey(p.name) === want || labelKey(p.name.split(' / ').at(-1) ?? '') === want);
  if (!hit) throw new TrackerError(`${LABEL} has no List “${nameOrId}” this connection can see.`, 'invalid', 400);
  return hit.key;
}

// ---- writing ----

const TTL_MS = 60_000;
const listCache = new Map<string, { at: number; statuses: Array<{ status: string; type?: string }>; members: Member[] }>();

async function listInfo(conn: ProviderConnection, list: string, fresh = false): Promise<{ statuses: Array<{ status: string; type?: string }>; members: Member[] }> {
  const key = `${conn.id}\n${list}`;
  const hit = listCache.get(key);
  if (hit && !fresh && Date.now() - hit.at < TTL_MS) return hit;
  const l = await api<{ statuses?: Array<{ status: string; type?: string }> }>(conn, 'GET', `/list/${seg(list)}`, `read List ${list}`);
  const m = await api<{ members?: Member[] }>(conn, 'GET', `/list/${seg(list)}/member`, `list the members of List ${list}`);
  const out = { at: Date.now(), statuses: l.statuses ?? [], members: m.members ?? [] };
  listCache.set(key, out);
  return out;
}

const memberByEmail = (members: Member[], email: string) => members.find((m) => (m.email ?? '').toLowerCase() === email.toLowerCase()) ?? null;

/** A mapped field's value as ClickUp takes it (POST /task/:id/field/:field), null to clear, or a note. */
function customWrite(f: Field, e: FieldMapEntry, v: CustomValue, members: Member[]): { value: unknown } | { note: string } {
  const name = e.trackerName || f.name || e.tracker;
  const option = (label: string) => (f.type_config?.options ?? []).find((o) => labelKey(o.name ?? o.label ?? '') === labelKey(label))?.id;
  switch (e.type) {
    case 'select': {
      if (v === null || v === '') return { value: null };
      const id = option(String(v));
      return id ? { value: id } : { note: `${name} in ${LABEL} has no option “${v}”, so it wasn’t sent.` };
    }
    case 'multiselect': {
      const labels = Array.isArray(v) ? v : v === null ? [] : [String(v)];
      const ids = labels.map(option);
      const missing = labels.filter((_, i) => !ids[i]);
      if (missing.length) return { note: `${name} in ${LABEL} has no option “${missing.join('”, “')}”, so it wasn’t sent.` };
      return { value: ids.length ? ids : null };
    }
    case 'number':
      return { value: typeof v === 'number' ? v : v === null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null };
    case 'date':
      return { value: typeof v === 'string' ? msOf(v) : null };
    case 'person': {
      if (v === null || v === '') return { value: null };
      const m = typeof v === 'string' && !v.startsWith('~') ? memberByEmail(members, v) : null;
      return m ? { value: { add: [m.id] } } : { note: `No one in this ${LABEL} List has the address ${v}, so ${name} wasn’t sent.` };
    }
    case 'text':
      return { value: v === null ? null : String(v) };
  }
}

/** Writes `values` (only those present) onto task `t`; returns notes for what couldn't be written. */
async function write(conn: ProviderConnection, t: ClickUpTask, values: IssueValues): Promise<string[]> {
  const notes: string[] = [];
  const data: Record<string, unknown> = {};
  const list = t.list?.id ?? null;
  const info = list && (values.assignee !== undefined || values.status !== undefined || values.statusName !== undefined || Object.keys(values.custom ?? {}).length) ? await listInfo(conn, list) : null;
  if (values.title !== undefined) data.name = values.title.replace(/\s+/g, ' ').trim().slice(0, 1000) || 'Untitled';
  if (values.description !== undefined) data.markdown_content = values.description;
  if (values.dueDate !== undefined) {
    data.due_date = msOf(values.dueDate);
    data.due_date_time = false;
  }
  if (values.startDate !== undefined) {
    data.start_date = msOf(values.startDate);
    data.start_date_time = false;
  }
  if (values.estimate !== undefined) data.points = values.estimate;
  if (values.priority !== undefined) {
    if (values.priority === null) data.priority = null;
    else {
      const at = PRIORITIES.findIndex((p) => labelKey(p) === labelKey(values.priority!));
      if (at >= 0) data.priority = at + 1;
      else notes.push(`${LABEL} has no priority “${values.priority}” (only ${PRIORITIES.join(', ')}), so it wasn’t sent.`);
    }
  }
  if (values.assignee !== undefined) {
    // The card has one assignee: it becomes the task's first; the others ClickUp lists stay.
    const have = (t.assignees ?? []).map((m) => m.id);
    const first = t.assignees?.[0];
    if (values.assignee === null) {
      if (first) data.assignees = { add: [], rem: [first.id] };
    } else if (values.assignee.startsWith('~')) {
      /* someone whose address ClickUp hides: nothing to match */
    } else {
      // Someone who joined the List a moment ago: asked again before saying there is no such person.
      const m = info ? (memberByEmail(info.members, values.assignee) ?? (list ? memberByEmail((await listInfo(conn, list, true)).members, values.assignee) : null)) : null;
      if (!m) notes.push(`No one in this ${LABEL} List has the address ${values.assignee}, so the assignee wasn’t sent.`);
      else if (!have.includes(m.id)) data.assignees = { add: [m.id], rem: first ? [first.id] : [] };
    }
  }
  if (values.statusName !== undefined || values.status !== undefined) {
    const statuses = info?.statuses ?? [];
    const current = t.status?.status ?? '';
    const want = values.status ?? null;
    const named = values.statusName ? statuses.find((s) => labelKey(s.status) === labelKey(values.statusName!)) : undefined;
    const byKind = !named && want && want !== clickupCategory(t.status) ? statuses.find((s) => clickupCategory(s) === want) : undefined;
    const target = named ?? byKind;
    if (target && labelKey(target.status) !== labelKey(current)) data.status = target.status;
    else if (!target && values.statusName && labelKey(values.statusName) !== labelKey(current))
      notes.push(`The List has no status “${values.statusName}” in ${LABEL}, so the task stayed in ${current || 'its status'}.`);
  }
  if (Object.keys(data).length) await api(conn, 'PUT', `/task/${seg(t.id)}`, 'change the task', data);

  for (const [id, v] of Object.entries(values.custom ?? {})) {
    const e = mapOf(conn).find((m) => m.tracker === id);
    if (!e || v === undefined) continue;
    const f = (t.custom_fields ?? []).find((x) => x.id === id);
    if (!f) {
      notes.push(`${e.trackerName || id} isn’t one of this task’s fields in ${LABEL} (add it to the List), so it wasn’t sent.`);
      continue;
    }
    const w = customWrite(f, e, v, info?.members ?? []);
    if ('note' in w) notes.push(w.note);
    else if (w.value === null) await api(conn, 'DELETE', `/task/${seg(t.id)}/field/${seg(id)}`, `clear ${e.trackerName || id}`);
    else await api(conn, 'POST', `/task/${seg(t.id)}/field/${seg(id)}`, `set ${e.trackerName || id}`, { value: w.value });
  }

  if (values.labels !== undefined) {
    const have = new Map((t.tags ?? []).map((x) => [labelKey(x.name ?? ''), x.name ?? '']));
    const want = new Map(values.labels.map((l) => [labelKey(clickup.label(l)), clickup.label(l)]));
    const space = t.space?.id ?? null;
    let spaceTags: Set<string> | null = null;
    for (const [key, name] of want) {
      if (have.has(key)) continue;
      if (space) {
        spaceTags ??= new Set(((await api<{ tags?: Array<{ name?: string }> }>(conn, 'GET', `/space/${seg(space)}/tag`, 'list tags')).tags ?? []).map((x) => labelKey(x.name ?? '')));
        if (!spaceTags.has(key)) {
          await api(conn, 'POST', `/space/${seg(space)}/tag`, `make the tag “${name}”`, { tag: { name } });
          spaceTags.add(key);
        }
      }
      await api(conn, 'POST', `/task/${seg(t.id)}/tag/${seg(name)}`, `tag the task “${name}”`);
    }
    for (const [key, name] of have) if (!want.has(key)) await api(conn, 'DELETE', `/task/${seg(t.id)}/tag/${seg(name)}`, 'remove a tag');
  }
  return notes;
}

const header = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export const clickup: TrackerProvider = {
  kind: 'clickup',
  fields: ['title', 'description', 'status', 'statusName', 'priority', 'assignee', 'labels', 'startDate', 'dueDate', 'estimate'],
  queryLanguage: 'Filter',
  parents: { issueType: null },

  authHeaders(creds: Credentials) {
    // Personal tokens (pk_…) and OAuth access tokens both go as they are.
    return { authorization: creds.kind === 'oauth' ? creds.accessToken : creds.token };
  },

  async whoAmI(conn) {
    const me = (await api<{ user?: Member }>(conn, 'GET', '/user', 'say who the connection is')).user;
    if (!me) throw new TrackerError(`${LABEL} didn’t say who the connection is.`, 'invalid');
    const teams = await teamsOf(conn);
    return { account: me.email ?? me.username ?? 'ClickUp user', settings: { accountId: String(me.id), workspace: conn.settings.workspace ?? teams[0]?.id ?? null } };
  },

  async listProjects(conn) {
    const out: TrackerProject[] = [];
    const teams = await teamsOf(conn);
    for (const team of teams) {
      const spaces = (await api<{ spaces?: Array<{ id: string; name?: string }> }>(conn, 'GET', `/team/${seg(team.id)}/space?archived=false`, 'list its Spaces')).spaces ?? [];
      for (const s of spaces) {
        const prefix = [...(teams.length > 1 ? [team.name ?? team.id] : []), s.name ?? s.id];
        const folders = (await api<{ folders?: Array<{ id: string; name?: string; lists?: Array<{ id: string; name?: string }> }> }>(conn, 'GET', `/space/${seg(s.id)}/folder?archived=false`, 'list its Folders')).folders ?? [];
        for (const f of folders) for (const l of f.lists ?? []) out.push({ id: l.id, key: l.id, name: [...prefix, f.name ?? f.id, l.name ?? l.id].join(' / ') });
        const lists = (await api<{ lists?: Array<{ id: string; name?: string }> }>(conn, 'GET', `/space/${seg(s.id)}/list?archived=false`, 'list its Lists')).lists ?? [];
        for (const l of lists) out.push({ id: l.id, key: l.id, name: [...prefix, l.name ?? l.id].join(' / ') });
        if (out.length > 500) break;
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },

  async listFields(conn) {
    const team = conn.settings.workspace;
    if (!team) return [];
    const kinds: Record<string, MappedFieldType> = { short_text: 'text', text: 'text', url: 'text', email: 'text', phone: 'text', number: 'number', currency: 'number', drop_down: 'select', labels: 'multiselect', date: 'date', users: 'person' };
    const fields = (await api<{ fields?: Field[] }>(conn, 'GET', `/team/${seg(team)}/field`, 'list its custom fields')).fields ?? [];
    return fields
      .filter((f) => f.name)
      .map((f): TrackerFieldInfo => ({ id: f.id, name: f.name!, type: kinds[f.type ?? ''] ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async priorities() {
    return [...PRIORITIES];
  },

  async getIssue(conn, id) {
    const t = await getTask(conn, id);
    return t ? clickupToRemote(conn, t) : null;
  },

  async createIssue(conn, input: CreateIssueInput) {
    if (!ID.test(input.project)) throw new TrackerError(`${input.project} isn’t a ${LABEL} List.`, 'invalid', 400);
    const parent = input.parent ? clickupTaskId(input.parent) : null;
    if (input.parent && !parent) throw new TrackerError(`${input.parent} isn’t a ${LABEL} task.`, 'invalid', 400);
    const v = input.values;
    const data: Record<string, unknown> = { name: (v.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000) || 'Untitled' };
    if (v.description !== undefined) data.markdown_content = v.description;
    if (parent) data.parent = parent;
    const made = await api<ClickUpTask>(conn, 'POST', `/list/${seg(input.project)}/task`, `create a task in List ${input.project}`, data);
    // Everything else as an edit of the new task: the same rules as a sync (statuses, tags, people).
    const { title: _t, description: _d, ...rest } = v;
    const notes: string[] = [];
    const fresh = (await getTask(conn, made.id)) ?? made;
    if (Object.keys(rest).length) notes.push(...(await write(conn, fresh, { ...rest, ...(rest.assignee === null ? { assignee: undefined } : {}) })));
    return { issue: clickupToRemote(conn, (await getTask(conn, made.id)) ?? fresh), notes };
  },

  async updateIssue(conn, issue, patch) {
    // Read now for what a write needs (the List's statuses and members, the fields' options); the
    // PUT names only the fields this sync changes, so what someone else changed meanwhile stays.
    const t = await getTask(conn, issue.id);
    if (!t) throw new TrackerError(`${issue.key} no longer exists in ${LABEL}.`, 'not_found', 404);
    return write(conn, t, patch);
  },

  async search(conn, query, limit) {
    const f = parseClickUpFilter(query);
    const listRef = f.list || conn.settings.project || null;
    if (!listRef) throw new TrackerError(`Name a List (list:<name>) to import from ${LABEL}.`, 'invalid', 400);
    const list = await listNamed(conn, listRef);
    const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
    const me = f.assignee === 'me' ? (conn.settings.account ?? '').toLowerCase() : f.assignee;
    return (await listTasks(conn, list, 1000))
      .map((t) => clickupToRemote(conn, t))
      .filter(
        (i) =>
          (!f.status || labelKey(i.values.statusName ?? '') === labelKey(f.status)) &&
          (!me || i.values.assignee === me) &&
          (!f.tag || i.values.labels.some((l) => labelKey(l) === labelKey(f.tag!))) &&
          (f.done === undefined || (i.values.status === 'done') === f.done) &&
          words.every((w) => i.values.title.toLowerCase().includes(w)),
      )
      .slice(0, limit);
  },

  async scoped(conn, scope, limit) {
    if (scope.epic) {
      const parent = clickupTaskId(scope.epic);
      if (!parent) throw new TrackerError(`${scope.epic} isn’t a ${LABEL} task.`, 'invalid', 400);
      const t = await getTask(conn, parent, '&include_subtasks=true');
      if (!t) throw new TrackerError(`${LABEL} has no task ${scope.epic} this connection can see.`, 'invalid', 400);
      const subs = (t.subtasks ?? []).slice(0, limit);
      // Subtasks come without everything a card needs: each is read in full.
      const out: RemoteIssue[] = [];
      for (const s of subs) {
        const full = await getTask(conn, s.id);
        if (full) out.push(clickupToRemote(conn, full));
      }
      return out;
    }
    return (await listTasks(conn, await listNamed(conn, scope.project), limit)).map((t) => clickupToRemote(conn, t));
  },

  dependencies: {
    // ClickUp's "waiting on": the blocked task depends on the blocker.
    async add(conn, blocker, blocked) {
      await api(conn, 'POST', `/task/${seg(blocked)}/dependency`, 'add a dependency', { depends_on: blocker });
    },
    async remove(conn, blocker, blocked) {
      const res = await conn.call({ method: 'DELETE', path: `/task/${seg(blocked)}/dependency?depends_on=${seg(blocker)}` });
      if (!ok(res) && res.status !== 404) throw refused(res, 'remove a dependency');
    },
  },

  async changedSince(conn, issues, since) {
    const ids = new Set(issues.map((i) => i.id));
    if (!ids.size) return [];
    const teams = conn.settings.workspace ? [{ id: conn.settings.workspace }] : await teamsOf(conn);
    const out: string[] = [];
    for (const team of teams) {
      for (let page = 0; page < 20; page++) {
        const j = await api<{ tasks?: ClickUpTask[]; last_page?: boolean }>(
          conn,
          'GET',
          `/team/${seg(team.id)}/task?date_updated_gt=${Math.max(0, Math.floor(since) - 1)}&include_closed=true&subtasks=true&page=${page}`,
          'check what changed',
        );
        for (const t of j.tasks ?? []) if (ids.has(t.id)) out.push(t.id);
        if (j.last_page !== false || !(j.tasks ?? []).length) break;
      }
    }
    return out;
  },

  async setBacklinks(conn, issue, links: Backlink[], removed) {
    // One comment by Freero lists the board items; it is edited (or removed) as they change.
    const comments = (await api<{ comments?: Array<{ id: string; comment_text?: string; user?: { id?: number | string } }> }>(conn, 'GET', `/task/${seg(issue.id)}/comment`, `read the comments of ${issue.key}`)).comments ?? [];
    const mine = comments.find((c) => (c.comment_text ?? '').startsWith(LINKS_MARK) && (!conn.settings.accountId || String(c.user?.id ?? '') === conn.settings.accountId));
    const kept = links.filter((l) => !removed.includes(l.itemId));
    if (!kept.length) {
      if (mine) await api(conn, 'DELETE', `/comment/${seg(mine.id)}`, 'remove the links back to the board');
      return;
    }
    const text = [LINKS_MARK, ...kept.map((l) => `- ${l.title.replace(/\s+/g, ' ').slice(0, 200)}: ${l.url}`)].join('\n');
    if (mine) {
      if (mine.comment_text !== text) await api(conn, 'PUT', `/comment/${seg(mine.id)}`, `link ${issue.key} back to the board`, { comment_text: text });
    } else await api(conn, 'POST', `/task/${seg(issue.id)}/comment`, `link ${issue.key} back to the board`, { comment_text: text, notify_all: false });
  },

  label: (tag) => tag.trim().slice(0, 100),

  webhooks: {
    signed: true,
    async register(conn, project, address) {
      if (!ID.test(project)) throw new TrackerError(`${project} isn’t a ${LABEL} List.`, 'invalid', 400);
      const team = conn.settings.workspace ?? (await teamsOf(conn))[0]?.id;
      if (!team) throw new TrackerError(`${LABEL} names no Workspace for this connection.`, 'invalid', 400);
      // ClickUp hands the secret its deliveries are signed with back right here.
      const made = await api<{ id?: string; webhook?: { id?: string; secret?: string } }>(conn, 'POST', `/team/${seg(team)}/webhook`, `watch List ${project}`, { endpoint: address, events: ['*'], list_id: project });
      const id = made.id ?? made.webhook?.id;
      if (!id) throw new TrackerError(`${LABEL} didn’t say which webhook it made.`, 'invalid');
      return { id: String(id), ...(made.webhook?.secret ? { secret: made.webhook.secret } : {}) };
    },
    async unregister(conn, id) {
      const res = await conn.call({ method: 'DELETE', path: `/webhook/${seg(id)}` });
      if (!ok(res) && res.status !== 404) throw refused(res, 'stop a webhook');
    },
  },

  webhook(d: WebhookDelivery) {
    // Only webhooks Freero registered (the service checked the address's key), signed with the
    // secret ClickUp issued when it made the webhook.
    const secret = d.hook?.secret;
    const given = header(d.headers['x-signature']);
    if (!secret || !given || !/^[0-9a-f]{64}$/i.test(given)) return null;
    const want = createHmac('sha256', secret).update(d.rawBody).digest();
    const got = Buffer.from(given, 'hex');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    let body: { task_id?: unknown } | null = null;
    try {
      body = JSON.parse(d.rawBody.toString('utf8'));
    } catch {
      return { issues: [] };
    }
    return { issues: typeof body?.task_id === 'string' && ID.test(body.task_id) ? [body.task_id] : [] };
  },
};

// ---- OAuth (the operator's ClickUp app; its access tokens don't expire) ----

export const clickupOAuth: OAuthProvider = {
  kind: 'clickup',
  authorizeUrl({ clientId, redirectUri, state }) {
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state });
    return `${getConfig().trackers.clickupUrl}/api?${q}`;
  },
  async redeem({ clientId, clientSecret, code }) {
    const api = getConfig().trackers.clickupApiUrl;
    const q = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code });
    const res = await trackerRequest({ method: 'POST', url: `${api}/api/v2/oauth/token?${q}` }, { allowPrivate: getConfig().trackers.privateEndpoints });
    const j = res.json as { access_token?: string } | null;
    if (!ok(res) || !j?.access_token) throw new TrackerError(`${LABEL} refused the authorization${trackerMessage(res.json) ? `: ${trackerMessage(res.json)}` : '.'}`, 'auth', res.status || 401);
    return { credentials: { kind: 'oauth', accessToken: j.access_token, refreshToken: null, expiresAt: null }, sites: [{ site: getConfig().trackers.clickupUrl, apiBase: `${api}/api/v2`, name: LABEL }] };
  },
  async refresh() {
    throw new TrackerError(`${LABEL}’s authorization ended: connect it again.`, 'auth', 401);
  },
};
