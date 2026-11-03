// Asana (#120), through its public REST API (https://app.asana.com/api/1.0) with a personal access
// token or the operator's OAuth app. Tasks are the issues; a "project" is an Asana project (its
// gid), and the column a card stands in is the task's section in it.
//
//   Fields     name, notes (`html_notes`, Asana's rich text, from a fixed escaped template), the
//              assignee by email (Asana takes an address), due_on / start_on, tags (by name, made
//              when missing), completed + section ↔ status and the kanban column by name, mapped
//              custom fields (#43: text, number, enum, multi-enum, date, people) by gid, a parent
//              task (a subtask: `parent` when creating).
//   Writes     only the fields that changed, each in its own place: a PUT names only those fields
//              (so another field someone changed meanwhile is never written over), a section move
//              is addTask, tags are addTag / removeTag.
//   Backlinks  external attachments, one per board item (found again by their URL).
//   Inbound    webhooks Freero registers per project (`webhooks`): Asana shakes hands by posting an
//              X-Hook-Secret that must come back in the answer, then signs every delivery with it
//              (X-Hook-Signature, HMAC-SHA256 of the body). Polling (modified_at, batched) catches
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
} from '@freero/shared';
import { getConfig } from '../../../platform/config';
import { FormFields, trackerMessage, trackerRequest, TrackerError, type HttpResponse } from '../http';
import { asanaHtmlToMarkdown, markdownToAsanaHtml } from '../markup';
import type { Backlink, CreateIssueInput, Credentials, OAuthProvider, ProviderConnection, RemoteIssue, TrackerProvider, WebhookDelivery } from './types';

const LABEL = TRACKER_PROVIDERS.asana;

const TASK_FIELDS = [
  'name',
  'html_notes',
  'completed',
  'assignee.email',
  'assignee.name',
  'due_on',
  'start_on',
  'tags.name',
  'memberships.project.name',
  'memberships.section.name',
  'parent.name',
  'modified_at',
  'permalink_url',
  'workspace.name',
  'custom_fields.name',
  'custom_fields.resource_subtype',
  'custom_fields.text_value',
  'custom_fields.number_value',
  'custom_fields.enum_value.name',
  'custom_fields.multi_enum_values.name',
  'custom_fields.date_value.date',
  'custom_fields.people_value.email',
  'custom_fields.enum_options.name',
  'custom_fields.enum_options.enabled',
].join(',');

interface Ref {
  gid: string;
  name?: string;
  email?: string | null;
}

interface CustomField {
  gid: string;
  name?: string;
  resource_subtype?: string;
  text_value?: string | null;
  number_value?: number | null;
  enum_value?: Ref | null;
  multi_enum_values?: Ref[] | null;
  date_value?: { date?: string | null } | null;
  people_value?: Ref[] | null;
  enum_options?: Array<Ref & { enabled?: boolean }>;
}

interface Task {
  gid: string;
  name?: string;
  html_notes?: string;
  completed?: boolean;
  assignee?: Ref | null;
  due_on?: string | null;
  start_on?: string | null;
  tags?: Ref[];
  memberships?: Array<{ project?: Ref; section?: Ref | null }>;
  parent?: Ref | null;
  modified_at?: string;
  permalink_url?: string;
  workspace?: Ref;
  custom_fields?: CustomField[];
}

const ok = (res: HttpResponse) => res.status >= 200 && res.status < 300;
const seg = (s: string) => encodeURIComponent(s);
const GID = /^\d{1,24}$/;
const mapOf = (conn: ProviderConnection): FieldMapEntry[] => conn.settings.fieldMap ?? [];

/** Asana's answer in Freero's words. */
function refused(res: HttpResponse, what: string): TrackerError {
  const said = trackerMessage(res.json);
  if (res.status === 401) return new TrackerError(`${LABEL} refused the credentials. Check the connection’s personal access token.`, 'auth', 401);
  if (res.status === 402) return new TrackerError(`${LABEL} needs a paid plan to ${what}.`, 'invalid', 402);
  if (res.status === 403) return new TrackerError(`${LABEL} doesn’t allow this connection to ${what}${said ? ` (${said.slice(0, 200)})` : ''}.`, 'refused', 403);
  if (res.status === 404) return new TrackerError(`${LABEL} couldn’t find what Freero asked for (${what}).`, 'not_found', 404);
  return new TrackerError(`${LABEL} refused to ${what}${said ? `: ${said.slice(0, 300)}` : ` (${res.status})`}.`, 'invalid', res.status);
}

/** One call; resolves with Asana's `data` (and `next_page`), throws in Freero's words. */
async function api<T>(conn: ProviderConnection, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, what: string, body?: unknown): Promise<{ data: T; next: string | null }> {
  const res = await conn.call({ method, path, ...(body !== undefined ? { body: body instanceof FormFields ? body : { data: body } } : {}) });
  if (!ok(res)) throw refused(res, what);
  const j = (res.json ?? {}) as { data?: T; next_page?: { offset?: string } | null };
  return { data: j.data as T, next: j.next_page?.offset ?? null };
}

/** Every page of a list, up to `limit` entries. */
async function list<T>(conn: ProviderConnection, path: string, what: string, limit: number): Promise<T[]> {
  const out: T[] = [];
  let offset: string | null = null;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const page: { data: T[]; next: string | null } = await api<T[]>(conn, 'GET', `${path}${sep}limit=${Math.min(100, limit - out.length)}${offset ? `&offset=${seg(offset)}` : ''}`, what);
    out.push(...(page.data ?? []));
    offset = page.next;
  } while (offset && out.length < limit);
  return out.slice(0, limit);
}

// ---- reading ----

const DONE = /\b(done|completed?|finished|shipped|closed|released|resolved)\b/i;
const DOING = /\b(doing|in progress|progress|review|reviewing|active|working|started|wip|testing|qa|blocked)\b/i;

/** Where a task stands: done when completed, else what its section's name says (to do by default). */
export function asanaCategory(completed: boolean, section: string | null): IssueStatusCategory {
  if (completed) return 'done';
  if (section && DONE.test(section)) return 'done';
  if (section && DOING.test(section)) return 'doing';
  return 'todo';
}

/** The membership a task's status comes from: the first with a section. */
const membershipOf = (t: Task) => t.memberships?.find((m) => m.project?.gid && m.section) ?? t.memberships?.find((m) => m.project?.gid) ?? null;

const emailOf = (u: Ref | null | undefined): string | null => (!u ? null : u.email ? u.email.toLowerCase() : `~${u.name ?? u.gid}`);

function customOf(type: MappedFieldType, f: CustomField | undefined): CustomValue | undefined {
  if (!f) return undefined;
  switch (type) {
    case 'select':
      return f.enum_value?.name ?? null;
    case 'multiselect':
      return (f.multi_enum_values ?? []).map((o) => o.name ?? '').filter(Boolean);
    case 'number':
      return typeof f.number_value === 'number' ? f.number_value : null;
    case 'date':
      return f.date_value?.date?.slice(0, 10) ?? null;
    case 'person':
      return emailOf(f.people_value?.[0]);
    case 'text':
      return f.text_value ?? null;
  }
}

function toRemote(conn: ProviderConnection, t: Task): RemoteIssue {
  const m = membershipOf(t);
  const project = m?.project?.gid ?? null;
  const section = m?.section?.name ?? null;
  const fields = new Map((t.custom_fields ?? []).map((f) => [f.gid, f]));
  const custom = mapOf(conn).length
    ? Object.fromEntries(
        mapOf(conn).flatMap((e) => {
          const v = customOf(e.type, fields.get(e.tracker));
          return v === undefined ? [] : [[e.tracker, v]];
        }),
      )
    : null;
  return {
    id: t.gid,
    key: t.gid,
    url: t.permalink_url && /^https?:\/\//.test(t.permalink_url) ? t.permalink_url : `${conn.site.replace(/\/+$/, '')}/0/${project ?? 0}/${t.gid}`,
    values: {
      title: t.name ?? '',
      description: asanaHtmlToMarkdown(t.html_notes),
      status: asanaCategory(!!t.completed, section),
      statusName: section,
      assignee: emailOf(t.assignee),
      labels: (t.tags ?? []).map((x) => x.name ?? '').filter(Boolean),
      startDate: t.start_on?.slice(0, 10) ?? null,
      dueDate: t.due_on?.slice(0, 10) ?? null,
      ...(custom ? { custom } : {}),
    },
    assigneeName: t.assignee?.name ?? null,
    updatedAt: t.modified_at ? Date.parse(t.modified_at) || 0 : 0,
    groups: { team: m?.project?.name ?? null, epic: t.parent?.gid ?? null },
    project,
  };
}

async function getTask(conn: ProviderConnection, gid: string): Promise<Task | null> {
  if (!GID.test(gid)) return null;
  const res = await conn.call({ method: 'GET', path: `/tasks/${gid}?opt_fields=${TASK_FIELDS}` });
  if (res.status === 404) return null;
  if (!ok(res)) throw refused(res, 'read the task');
  return (res.json as { data?: Task })?.data ?? null;
}

const projectTasks = (conn: ProviderConnection, project: string, limit: number) => list<Task>(conn, `/projects/${seg(project)}/tasks?opt_fields=${TASK_FIELDS}`, `list the tasks of project ${project}`, limit);

/** A task's gid from what people paste: the gid, or the task's address (…/0/<project>/<task>). */
export function taskGid(s: string): string | null {
  const t = s.trim();
  if (GID.test(t)) return t;
  const m = /\/(\d{1,24})(?:\/f)?\/?(?:[?#].*)?$/.exec(t);
  return m ? m[1] : null;
}

// ---- the filter people type to import (Asana's own search needs a paid plan) ----

/** `project:<gid or name> section:"Doing" assignee:me done:no words…` → its parts. */
export function parseFilter(q: string): { project?: string; section?: string; assignee?: string; done?: boolean; text: string } {
  const out: { project?: string; section?: string; assignee?: string; done?: boolean; text: string } = { text: '' };
  const rest: string[] = [];
  for (const m of q.matchAll(/(\w+):(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g)) {
    const key = m[1]?.toLowerCase();
    const value = (m[2] ?? m[3] ?? '').trim();
    if (key === 'project' || key === 'in') out.project = value;
    else if (key === 'section' || key === 'column') out.section = value;
    else if (key === 'assignee') out.assignee = value.toLowerCase();
    else if (key === 'done' || key === 'completed') out.done = /^(yes|true|1)$/i.test(value);
    else rest.push(m[4] ?? m[5] ?? m[0]);
  }
  out.text = rest.join(' ').trim();
  return out;
}

async function projectNamed(conn: ProviderConnection, nameOrGid: string): Promise<string> {
  if (GID.test(nameOrGid)) return nameOrGid;
  const hit = (await asana.listProjects(conn)).find((p) => labelKey(p.name) === labelKey(nameOrGid));
  if (!hit) throw new TrackerError(`${LABEL} has no project “${nameOrGid}” this connection can see.`, 'invalid', 400);
  return hit.key;
}

// ---- writing ----

const SECTION_TTL_MS = 60_000;
const sectionsCache = new Map<string, { at: number; list: Ref[] }>();

async function sectionsOf(conn: ProviderConnection, project: string): Promise<Ref[]> {
  const key = `${conn.id}\n${project}`;
  const hit = sectionsCache.get(key);
  if (hit && Date.now() - hit.at < SECTION_TTL_MS) return hit.list;
  const out = await list<Ref>(conn, `/projects/${seg(project)}/sections?opt_fields=name`, `list the sections of project ${project}`, 200);
  sectionsCache.set(key, { at: Date.now(), list: out });
  return out;
}

async function userGid(conn: ProviderConnection, email: string): Promise<string | null> {
  const res = await conn.call({ method: 'GET', path: `/users/${seg(email)}?opt_fields=email` });
  if (res.status === 404 || res.status === 400) return null;
  if (!ok(res)) throw refused(res, 'look up a person');
  return (res.json as { data?: Ref })?.data?.gid ?? null;
}

async function tagGid(conn: ProviderConnection, workspace: string, name: string): Promise<string> {
  const tags = await list<Ref>(conn, `/workspaces/${seg(workspace)}/tags?opt_fields=name`, 'list tags', 1000);
  const hit = tags.find((t) => labelKey(t.name ?? '') === labelKey(name));
  if (hit) return hit.gid;
  return (await api<Ref>(conn, 'POST', '/tags', `make the tag “${name}”`, { name, workspace })).data.gid;
}

/** A mapped field's value as Asana takes it in `custom_fields`, or a note why it can't. */
async function customWrite(conn: ProviderConnection, f: CustomField, e: FieldMapEntry, v: CustomValue): Promise<{ value: unknown } | { note: string }> {
  const name = e.trackerName || f.name || e.tracker;
  const option = (label: string) => (f.enum_options ?? []).find((o) => o.enabled !== false && labelKey(o.name ?? '') === labelKey(label))?.gid;
  switch (e.type) {
    case 'select': {
      if (v === null || v === '') return { value: null };
      const gid = option(String(v));
      return gid ? { value: gid } : { note: `${name} in ${LABEL} has no option “${v}”, so it wasn’t sent.` };
    }
    case 'multiselect': {
      const labels = Array.isArray(v) ? v : v === null ? [] : [String(v)];
      const gids = labels.map(option);
      const missing = labels.filter((_, i) => !gids[i]);
      if (missing.length) return { note: `${name} in ${LABEL} has no option “${missing.join('”, “')}”, so it wasn’t sent.` };
      return { value: gids };
    }
    case 'number':
      return { value: typeof v === 'number' ? v : v === null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null };
    case 'date':
      return { value: typeof v === 'string' && v ? { date: v.slice(0, 10) } : null };
    case 'person': {
      if (v === null || v === '') return { value: [] };
      if (typeof v !== 'string' || v.startsWith('~')) return { note: `${name}: ${LABEL} hides that person’s address, so it wasn’t sent.` };
      const gid = await userGid(conn, v);
      return gid ? { value: [gid] } : { note: `No one in ${LABEL} has the address ${v}, so ${name} wasn’t sent.` };
    }
    case 'text':
      return { value: v === null ? '' : String(v) };
  }
}

/** Writes `values` (only those present) onto task `t`; returns notes for what couldn't be written. */
async function write(conn: ProviderConnection, t: Task, values: IssueValues): Promise<string[]> {
  const notes: string[] = [];
  const data: Record<string, unknown> = {};
  if (values.title !== undefined) data.name = values.title.replace(/\s+/g, ' ').trim().slice(0, 1024) || 'Untitled';
  if (values.description !== undefined) data.html_notes = markdownToAsanaHtml(values.description);
  if (values.dueDate !== undefined) data.due_on = values.dueDate;
  if (values.startDate !== undefined) {
    // Asana keeps a start date only with a due date.
    const due = values.dueDate !== undefined ? values.dueDate : (t.due_on ?? null);
    if (values.startDate && !due) notes.push(`${LABEL} keeps a start date only on a task with a due date, so the start date wasn’t sent.`);
    else data.start_on = values.startDate;
  }
  if (values.assignee !== undefined) {
    // Asana takes an address for the assignee; '~' is someone whose address it hides.
    if (values.assignee === null) data.assignee = null;
    else if (!values.assignee.startsWith('~')) data.assignee = values.assignee;
  }
  const custom: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(values.custom ?? {})) {
    const e = mapOf(conn).find((m) => m.tracker === id);
    if (!e || v === undefined) continue;
    const f = (t.custom_fields ?? []).find((x) => x.gid === id);
    if (!f) {
      notes.push(`${e.trackerName || id} isn’t one of this task’s fields in ${LABEL} (add it to the project), so it wasn’t sent.`);
      continue;
    }
    const w = await customWrite(conn, f, e, v);
    if ('note' in w) notes.push(w.note);
    else custom[id] = w.value;
  }
  if (Object.keys(custom).length) data.custom_fields = custom;

  // Status: the section named like the card's column, else the first of the wanted kind; done is completed.
  const m = membershipOf(t);
  if (values.statusName !== undefined || values.status !== undefined) {
    const want = values.status ?? null;
    if (want !== null && (want === 'done') !== !!t.completed) data.completed = want === 'done';
    if (m?.project?.gid) {
      const sections = await sectionsOf(conn, m.project.gid);
      const current = m.section?.gid ?? null;
      const named = values.statusName ? sections.find((s) => labelKey(s.name ?? '') === labelKey(values.statusName!)) : undefined;
      const currentKind = asanaCategory(false, m.section?.name ?? null);
      const byKind = !named && want && want !== currentKind ? sections.find((s) => asanaCategory(false, s.name ?? null) === want) : undefined;
      const target = named ?? byKind;
      if (target && target.gid !== current) await api(conn, 'POST', `/sections/${seg(target.gid)}/addTask`, `move the task to ${target.name ?? 'a section'}`, { task: t.gid });
      else if (!target && values.statusName && labelKey(values.statusName) !== labelKey(m.section?.name ?? ''))
        notes.push(`The project has no section “${values.statusName}” in ${LABEL}, so the task stayed in ${m.section?.name ?? 'its section'}.`);
    }
  }
  if (Object.keys(data).length) await api(conn, 'PUT', `/tasks/${seg(t.gid)}`, 'change the task', data);

  if (values.labels !== undefined) {
    const have = new Map((t.tags ?? []).map((x) => [labelKey(x.name ?? ''), x.gid]));
    const want = new Map(values.labels.map((l) => [labelKey(asana.label(l)), asana.label(l)]));
    const workspace = t.workspace?.gid ?? conn.settings.workspace ?? null;
    for (const [key, name] of want)
      if (!have.has(key) && workspace) await api(conn, 'POST', `/tasks/${seg(t.gid)}/addTag`, `tag the task “${name}”`, { tag: await tagGid(conn, workspace, name) });
    for (const [key, gid] of have) if (!want.has(key)) await api(conn, 'POST', `/tasks/${seg(t.gid)}/removeTag`, 'remove a tag', { tag: gid });
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

export const asana: TrackerProvider = {
  kind: 'asana',
  fields: ['title', 'description', 'status', 'statusName', 'assignee', 'labels', 'startDate', 'dueDate'],
  queryLanguage: 'Filter',
  parents: { issueType: null },

  authHeaders(creds: Credentials) {
    return { authorization: `Bearer ${creds.kind === 'oauth' ? creds.accessToken : creds.token}` };
  },

  async whoAmI(conn) {
    const me = (await api<Ref & { workspaces?: Ref[] }>(conn, 'GET', '/users/me?opt_fields=email,name,workspaces.name', 'say who the connection is')).data;
    return { account: me.email ?? me.name ?? 'Asana user', settings: { accountId: me.gid, workspace: conn.settings.workspace ?? me.workspaces?.[0]?.gid ?? null } };
  },

  async listProjects(conn) {
    const me = (await api<{ workspaces?: Ref[] }>(conn, 'GET', '/users/me?opt_fields=workspaces.name', 'list its workspaces')).data;
    const workspaces = me.workspaces ?? [];
    const out = [];
    for (const w of workspaces) {
      const projects = await list<Ref>(conn, `/projects?workspace=${seg(w.gid)}&archived=false&opt_fields=name`, 'list projects', 500);
      for (const p of projects) out.push({ id: p.gid, key: p.gid, name: workspaces.length > 1 ? `${p.name ?? p.gid} · ${w.name ?? w.gid}` : (p.name ?? p.gid) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },

  async listFields(conn) {
    const workspace = conn.settings.workspace;
    if (!workspace) return [];
    const kinds: Record<string, MappedFieldType> = { text: 'text', number: 'number', enum: 'select', multi_enum: 'multiselect', date: 'date', people: 'person' };
    const fields = await list<{ gid: string; name?: string; resource_subtype?: string }>(conn, `/workspaces/${seg(workspace)}/custom_fields?opt_fields=name,resource_subtype`, 'list its custom fields', 500);
    return fields
      .filter((f) => f.name)
      .map((f): TrackerFieldInfo => ({ id: f.gid, name: f.name!, type: kinds[f.resource_subtype ?? ''] ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async getIssue(conn, id) {
    const t = await getTask(conn, id);
    return t ? toRemote(conn, t) : null;
  },

  async createIssue(conn, input: CreateIssueInput) {
    const notes: string[] = [];
    if (!GID.test(input.project)) throw new TrackerError(`${input.project} isn’t an ${LABEL} project.`, 'invalid', 400);
    const parent = input.parent ? taskGid(input.parent) : null;
    if (input.parent && !parent) throw new TrackerError(`${input.parent} isn’t an ${LABEL} task.`, 'invalid', 400);
    const v = input.values;
    const data: Record<string, unknown> = { name: (v.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 1024) || 'Untitled', projects: [input.project] };
    if (v.description !== undefined) data.html_notes = markdownToAsanaHtml(v.description);
    if (parent) data.parent = parent;
    const made = (await api<Task>(conn, 'POST', `/tasks?opt_fields=${TASK_FIELDS}`, `create a task in project ${input.project}`, data)).data;
    // Everything else as an edit of the new task: the same rules as a sync (sections, tags, people).
    const { title: _t, description: _d, ...rest } = v;
    if (Object.keys(rest).length) notes.push(...(await write(conn, (await getTask(conn, made.gid)) ?? made, { ...rest, ...(rest.assignee === null ? { assignee: undefined } : {}) })));
    const issue = toRemote(conn, (await getTask(conn, made.gid)) ?? made);
    return { issue, notes };
  },

  async updateIssue(conn, issue, patch) {
    // Read now for what a write needs (sections, tags, the fields' options); the PUT names only
    // the fields this sync changes, so what someone else changed meanwhile stays.
    const t = await getTask(conn, issue.id);
    if (!t) throw new TrackerError(`${issue.key} no longer exists in ${LABEL}.`, 'not_found', 404);
    return write(conn, t, patch);
  },

  async search(conn, query, limit) {
    const f = parseFilter(query);
    const projectRef = f.project || conn.settings.project || null;
    if (!projectRef) {
      // No project: Asana's own search, in the connection's workspace.
      const workspace = conn.settings.workspace;
      if (!workspace) throw new TrackerError(`Name a project (project:<name>) to import from ${LABEL}.`, 'invalid', 400);
      if (!f.text) throw new TrackerError(`Name a project (project:<name>) or some words to search for.`, 'invalid', 400);
      const q = new URLSearchParams({ text: f.text, opt_fields: TASK_FIELDS, limit: String(Math.min(100, limit)) });
      if (f.done !== undefined) q.set('completed', String(f.done));
      const res = await conn.call({ method: 'GET', path: `/workspaces/${seg(workspace)}/tasks/search?${q}` });
      if (res.status === 402) throw new TrackerError(`${LABEL} searches only on paid plans: name a project instead (project:<name>).`, 'invalid', 402);
      if (!ok(res)) throw refused(res, 'search tasks');
      return (((res.json as { data?: Task[] })?.data ?? []) as Task[]).slice(0, limit).map((t) => toRemote(conn, t));
    }
    const project = await projectNamed(conn, projectRef);
    const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
    const me = f.assignee === 'me' ? (conn.settings.account ?? '').toLowerCase() : f.assignee;
    return (await projectTasks(conn, project, 1000))
      .map((t) => toRemote(conn, t))
      .filter(
        (i) =>
          (!f.section || labelKey(i.values.statusName ?? '') === labelKey(f.section)) &&
          (!me || i.values.assignee === me) &&
          (f.done === undefined || (i.values.status === 'done') === f.done) &&
          words.every((w) => i.values.title.toLowerCase().includes(w)),
      )
      .slice(0, limit);
  },

  async scoped(conn, scope, limit) {
    if (scope.epic) {
      const parent = taskGid(scope.epic);
      if (!parent) throw new TrackerError(`${scope.epic} isn’t an ${LABEL} task.`, 'invalid', 400);
      const subtasks = await list<Task>(conn, `/tasks/${parent}/subtasks?opt_fields=${TASK_FIELDS}`, 'list the subtasks', limit);
      return subtasks.map((t) => toRemote(conn, t));
    }
    const project = await projectNamed(conn, scope.project);
    return (await projectTasks(conn, project, limit)).map((t) => toRemote(conn, t));
  },

  async changedSince(conn, issues, since) {
    const ids = issues.map((i) => i.id).filter((id) => GID.test(id));
    const out: string[] = [];
    // Ten reads per call (Asana's batch API), only the time each was last changed.
    for (let i = 0; i < ids.length; i += 10) {
      const actions = ids.slice(i, i + 10).map((gid) => ({ method: 'get', relative_path: `/tasks/${gid}`, options: { fields: ['modified_at'] } }));
      const { data } = await api<Array<{ status_code?: number; body?: { data?: Task } }>>(conn, 'POST', '/batch', 'check what changed', { actions });
      for (const r of data ?? []) {
        const t = r.body?.data;
        if (t?.gid && (Date.parse(t.modified_at ?? '') || 0) >= since) out.push(t.gid);
      }
    }
    return out;
  },

  async setBacklinks(conn, issue, links: Backlink[], removed) {
    const have = await list<{ gid: string; name?: string; view_url?: string | null; resource_subtype?: string }>(
      conn,
      `/attachments?parent=${seg(issue.id)}&opt_fields=name,view_url,resource_subtype`,
      `read the attachments of ${issue.key}`,
      500,
    );
    const external = have.filter((a) => a.resource_subtype === 'external' && a.view_url);
    for (const a of external) if (removed.includes(itemOfUrl(a.view_url!) ?? '')) await api(conn, 'DELETE', `/attachments/${seg(a.gid)}`, 'remove a link back to the board');
    const known = new Set(external.map((a) => a.view_url));
    for (const l of links)
      if (!known.has(l.url))
        await api(conn, 'POST', '/attachments', `link ${issue.key} back to the board`, new FormFields({ parent: issue.id, resource_subtype: 'external', url: l.url, name: `On a Freero board: ${l.title}`.slice(0, 250) }));
  },

  label: (tag) => tag.trim().slice(0, 100),

  webhooks: {
    signed: true,
    async register(conn, project, address) {
      if (!GID.test(project)) throw new TrackerError(`${project} isn’t an ${LABEL} project.`, 'invalid', 400);
      // Asana posts the handshake to `address` before it answers this.
      const made = await api<Ref>(conn, 'POST', '/webhooks', `watch project ${project}`, { resource: project, target: address, filters: [{ resource_type: 'task' }] });
      return { id: made.data.gid };
    },
    async unregister(conn, id) {
      const res = await conn.call({ method: 'DELETE', path: `/webhooks/${seg(id)}` });
      if (!ok(res) && res.status !== 404) throw refused(res, 'stop a webhook');
    },
  },

  webhook(d: WebhookDelivery) {
    // The handshake: answered (the secret echoed and kept) only while Freero is registering this
    // webhook and before any secret was kept — a stranger can't swap the secret afterwards.
    const offered = header(d.headers['x-hook-secret']);
    if (offered !== null) {
      if (!d.hook?.pending || d.hook.secret || !/^[\x21-\x7e]{8,512}$/.test(offered)) return null;
      return { issues: [], handshake: { headers: { 'X-Hook-Secret': offered }, keep: offered } };
    }
    const secret = d.hook?.secret;
    const given = header(d.headers['x-hook-signature']);
    if (!secret || !given || !/^[0-9a-f]{64}$/i.test(given)) return null;
    const want = createHmac('sha256', secret).update(d.rawBody).digest();
    const got = Buffer.from(given, 'hex');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    let body: { events?: Array<{ resource?: { gid?: unknown; resource_type?: unknown }; parent?: { gid?: unknown; resource_type?: unknown } | null }> } | null = null;
    try {
      body = JSON.parse(d.rawBody.toString('utf8'));
    } catch {
      return { issues: [] };
    }
    const issues = new Set<string>();
    for (const e of body?.events ?? []) {
      if (e.resource?.resource_type === 'task' && typeof e.resource.gid === 'string') issues.add(e.resource.gid);
      // A change to something on a task (a story, a subtask added): the task.
      if (e.parent?.resource_type === 'task' && typeof e.parent.gid === 'string') issues.add(e.parent.gid);
    }
    return { issues: [...issues] };
  },
};

// ---- OAuth (the operator's Asana app) ----

async function asanaToken(form: Record<string, string>): Promise<Extract<Credentials, { kind: 'oauth' }> & { user?: Ref }> {
  const res = await trackerRequest({ method: 'POST', url: `${getConfig().trackers.asanaUrl}/-/oauth_token`, body: new URLSearchParams(form) }, { allowPrivate: getConfig().trackers.privateEndpoints });
  const j = res.json as { access_token?: string; refresh_token?: string; expires_in?: number; data?: Ref } | null;
  if (!ok(res) || !j?.access_token) throw new TrackerError(`${LABEL} refused the authorization${trackerMessage(res.json) ? `: ${trackerMessage(res.json)}` : '.'}`, 'auth', res.status || 401);
  return {
    kind: 'oauth',
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? form.refresh_token ?? null,
    expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : null,
    user: j.data,
  };
}

export const asanaOAuth: OAuthProvider = {
  kind: 'asana',
  authorizeUrl({ clientId, redirectUri, state }) {
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', state, scope: 'default' });
    return `${getConfig().trackers.asanaUrl}/-/oauth_authorize?${q}`;
  },
  async redeem({ clientId, clientSecret, redirectUri, code }) {
    const { user: _u, ...credentials } = await asanaToken({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code });
    const site = getConfig().trackers.asanaUrl;
    return { credentials, sites: [{ site, apiBase: `${site}/api/1.0`, name: LABEL }] };
  },
  async refresh({ clientId, clientSecret, refreshToken }) {
    const { user: _u, ...credentials } = await asanaToken({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
    return credentials;
  },
};
