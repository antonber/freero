// Azure DevOps Boards (#6): Services (https://dev.azure.com/<organization>) and Server (an address
// of its own: https://tfs.acme.internal/tfs/<collection>), through the public REST API only, with a
// personal access token (Basic, an empty user name). Work items are the issues; a "project" is an
// Azure DevOps project.
//
//   Fields     System.Title, System.Description (HTML from a fixed, escaped template; read back as
//              text and links), System.Tags ("a; b"), System.AssignedTo (by email), state ↔ the
//              work item type's state categories, Microsoft.VSTS.Common.Priority (1–4),
//              Microsoft.VSTS.Scheduling.StartDate / TargetDate, story points / effort / size (the
//              field found when connecting), System.IterationPath ↔ the kanban's Iteration field
//              (#119), mapped custom fields (#43) by reference name, a parent through a
//              Hierarchy-Reverse relation.
//   Writes     JSON Patch with a `test` of the revision read first: a work item someone changed
//              since is never overwritten — the write is refused and the sync reads it again
//              (TrackerError 'conflict').
//   Backlinks  Hyperlink relations, one per board item (found again by their URL).
//   Inbound    service hooks (Web Hooks, "Work item updated"), authenticated with basic
//              authentication whose password is the connection's webhook secret — Azure DevOps
//              doesn't sign deliveries — or polling (System.ChangedDate), the only way for a Server
//              that can't reach Freero.
import { timingSafeEqual } from 'node:crypto';
import {
  labelKey,
  TRACKER_PROVIDERS,
  type CustomValue,
  type FieldMapEntry,
  type IssueStatusCategory,
  type IssueValues,
  type MappedFieldType,
  type TrackerFieldInfo,
  type TrackerSprint,
} from '@freero/shared';
import { trackerMessage, TrackerError, type HttpResponse } from '../http';
import { htmlToMarkdown, markdownToHtml } from '../markup';
import type { Backlink, CreateIssueInput, Credentials, ProviderConnection, RemoteIssue, TrackerProvider, WebhookDelivery } from './types';

const LABEL = TRACKER_PROVIDERS.azure;
/** Services take the current API; Server 2020 and later take 6.0. */
const apiVersion = (conn: Pick<ProviderConnection, 'deployment'>) => (conn.deployment === 'datacenter' ? '6.0' : '7.1');
const q = (conn: Pick<ProviderConnection, 'deployment'>) => `api-version=${apiVersion(conn)}`;
const PATCH = { 'content-type': 'application/json-patch+json' };

/** Fields Azure DevOps's processes give story points: Agile, Scrum (effort), CMMI (size). */
const ESTIMATE_FIELDS = ['Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.Effort', 'Microsoft.VSTS.Scheduling.Size'];
const START = 'Microsoft.VSTS.Scheduling.StartDate';
const TARGET = 'Microsoft.VSTS.Scheduling.TargetDate';
const PRIORITY = 'Microsoft.VSTS.Common.Priority';
/** Azure DevOps priorities, most pressing first. */
const PRIORITIES = ['1', '2', '3', '4'];

const CATEGORY: Record<string, IssueStatusCategory> = {
  Proposed: 'todo',
  InProgress: 'doing',
  Resolved: 'doing',
  Completed: 'done',
  Removed: 'done',
};
const CATEGORY_ORDER: Record<IssueStatusCategory, string[]> = { todo: ['Proposed'], doing: ['InProgress', 'Resolved'], done: ['Completed'] };

const ok = (res: HttpResponse) => res.status >= 200 && res.status < 300;

/** Azure DevOps's answer in Freero's words; a revision mismatch is a conflict (read again). */
function refused(res: HttpResponse, what: string): TrackerError {
  const said = trackerMessage(res.json) ?? (res.json as { message?: string } | null)?.message ?? null;
  if (res.status === 401 || res.status === 203) return new TrackerError(`${LABEL} refused the credentials. Check the connection’s personal access token.`, 'auth', 401);
  if (res.status === 412 || res.status === 409 || /TF26071|VS403\d+.*rev|revision/i.test(said ?? ''))
    return new TrackerError(`The work item changed in ${LABEL} while Freero was writing it.`, 'conflict', res.status);
  if (res.status === 403) return new TrackerError(`${LABEL} doesn’t allow this connection to ${what}${said ? ` (${said.slice(0, 200)})` : ''}.`, 'refused', 403);
  if (res.status === 404) return new TrackerError(`${LABEL} couldn’t find what Freero asked for (${what}).`, 'not_found', 404);
  return new TrackerError(`${LABEL} refused to ${what}${said ? `: ${said.slice(0, 300)}` : ` (${res.status})`}.`, 'invalid', res.status);
}

interface WorkItem {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
  relations?: Array<{ rel: string; url: string; attributes?: Record<string, unknown> }>;
}

interface Identity {
  displayName?: string;
  uniqueName?: string;
}

const projectOf = (w: WorkItem) => String(w.fields['System.TeamProject'] ?? '');
const seg = (s: string) => encodeURIComponent(s);
const mapOf = (conn: ProviderConnection): FieldMapEntry[] => conn.settings.fieldMap ?? [];

/** An identity field's email (Azure DevOps's unique name is the sign-in address). */
const emailOf = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return /<([^>]+@[^>]+)>/.exec(v)?.[1]?.toLowerCase() ?? (v.includes('@') ? v.toLowerCase() : `~${v}`);
  const u = v as Identity;
  return u.uniqueName?.includes('@') ? u.uniqueName.toLowerCase() : `~${u.displayName ?? u.uniqueName ?? 'someone'}`;
};

/** An iteration path in the board's terms: below the project ("Sprint 3", "Release 1\Sprint 3"); the project itself is none. */
const iterationLabel = (path: unknown, project: string): string | null => {
  if (typeof path !== 'string' || !path) return null;
  if (labelKey(path) === labelKey(project)) return null;
  return path.toLowerCase().startsWith(`${project.toLowerCase()}\\`) ? path.slice(project.length + 1) : path;
};

// ---- the work item types' states (category per state name), cached briefly ----

const STATE_TTL_MS = 10 * 60_000;
const states = new Map<string, { at: number; list: Array<{ name: string; category: string }> }>();

async function statesOf(conn: ProviderConnection, project: string, type: string): Promise<Array<{ name: string; category: string }>> {
  const key = `${conn.id}\n${project}\n${type}`;
  const hit = states.get(key);
  if (hit && Date.now() - hit.at < STATE_TTL_MS) return hit.list;
  const res = await conn.call({ method: 'GET', path: `/${seg(project)}/_apis/wit/workitemtypes/${seg(type)}/states?${q(conn)}` });
  if (!ok(res)) throw refused(res, `read the states of ${type}`);
  const list = (((res.json as { value?: unknown[] })?.value ?? []) as Array<{ name?: unknown; category?: unknown }>).flatMap((s) =>
    typeof s.name === 'string' ? [{ name: s.name, category: typeof s.category === 'string' ? s.category : '' }] : [],
  );
  states.set(key, { at: Date.now(), list });
  return list;
}

async function toRemote(conn: ProviderConnection, w: WorkItem): Promise<RemoteIssue> {
  const f = w.fields ?? {};
  const project = projectOf(w);
  const type = String(f['System.WorkItemType'] ?? 'Task');
  const state = typeof f['System.State'] === 'string' ? (f['System.State'] as string) : null;
  const category = state ? (await statesOf(conn, project, type).catch(() => [])).find((s) => s.name === state)?.category : undefined;
  const est = conn.settings.estimateField ? f[conn.settings.estimateField] : null;
  const date = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : null);
  const assigned = f['System.AssignedTo'];
  const parent = w.relations?.find((r) => r.rel === 'System.LinkTypes.Hierarchy-Reverse');
  return {
    id: String(w.id),
    key: `#${w.id}`,
    url: `${conn.site.replace(/\/+$/, '')}/${seg(project)}/_workitems/edit/${w.id}`,
    values: {
      title: typeof f['System.Title'] === 'string' ? (f['System.Title'] as string) : '',
      description: htmlToMarkdown(f['System.Description']),
      status: category ? (CATEGORY[category] ?? null) : null,
      statusName: state,
      priority: typeof f[PRIORITY] === 'number' ? String(f[PRIORITY]) : null,
      assignee: emailOf(assigned),
      labels: typeof f['System.Tags'] === 'string' ? (f['System.Tags'] as string).split(';').map((t) => t.trim()).filter(Boolean) : [],
      startDate: date(f[START]),
      dueDate: date(f[TARGET]),
      estimate: typeof est === 'number' ? est : null,
      sprint: iterationLabel(f['System.IterationPath'], project),
      ...(mapOf(conn).length ? { custom: Object.fromEntries(mapOf(conn).map((m) => [m.tracker, customOf(m.type, f[m.tracker])])) } : {}),
    },
    assigneeName: assigned && typeof assigned === 'object' ? ((assigned as Identity).displayName ?? null) : typeof assigned === 'string' ? assigned.replace(/\s*<[^>]*>$/, '') : null,
    updatedAt: typeof f['System.ChangedDate'] === 'string' ? Date.parse(f['System.ChangedDate'] as string) || 0 : 0,
    groups: { team: project || null, epic: parent ? `#${parent.url.split('/').pop()}` : null },
    project: project || null,
    version: String(w.rev),
  };
}

function customOf(type: MappedFieldType, raw: unknown): CustomValue {
  if (raw === null || raw === undefined || raw === '') return type === 'multiselect' ? [] : null;
  switch (type) {
    case 'multiselect':
      return String(raw).split(';').map((s) => s.trim()).filter(Boolean);
    case 'number':
      return typeof raw === 'number' ? raw : Number.isFinite(Number(raw)) ? Number(raw) : null;
    case 'date':
      return typeof raw === 'string' ? raw.slice(0, 10) : null;
    case 'person':
      return emailOf(raw);
    case 'text':
      return typeof raw === 'string' ? (/<[a-z][^>]*>/i.test(raw) ? htmlToMarkdown(raw) : raw) : String(raw);
    default:
      return String(raw);
  }
}

async function getWorkItem(conn: ProviderConnection, id: string): Promise<WorkItem | null> {
  if (!/^\d{1,10}$/.test(id.replace(/^#/, ''))) return null;
  const res = await conn.call({ method: 'GET', path: `/_apis/wit/workitems/${id.replace(/^#/, '')}?$expand=relations&${q(conn)}` });
  if (res.status === 404) return null;
  if (!ok(res)) throw refused(res, 'read the work item');
  return res.json as WorkItem;
}

/** Work items by id, in that order (batches of 200). */
async function workItems(conn: ProviderConnection, ids: number[], fields?: string[]): Promise<WorkItem[]> {
  const out: WorkItem[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const res = await conn.call({ method: 'POST', path: `/_apis/wit/workitemsbatch?${q(conn)}`, body: { ids: ids.slice(i, i + 200), ...(fields ? { fields } : {}), errorPolicy: 'omit' } });
    if (!ok(res)) throw refused(res, 'read work items');
    out.push(...(((res.json as { value?: unknown[] })?.value ?? []) as Array<WorkItem | null>).filter((w): w is WorkItem => !!w));
  }
  return out;
}

const wiqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function wiql(conn: ProviderConnection, query: string, limit: number, project?: string): Promise<RemoteIssue[]> {
  const res = await conn.call({ method: 'POST', path: `${project ? `/${seg(project)}` : ''}/_apis/wit/wiql?$top=${Math.min(200, limit)}&${q(conn)}`, body: { query } });
  if (res.status === 400) throw new TrackerError(`${LABEL} couldn’t run that WIQL${trackerMessage(res.json) ? `: ${trackerMessage(res.json)}` : '.'}`, 'invalid', 400);
  if (!ok(res)) throw refused(res, 'run the query');
  const ids = (((res.json as { workItems?: unknown[] })?.workItems ?? []) as Array<{ id?: number }>).flatMap((w) => (typeof w.id === 'number' ? [w.id] : [])).slice(0, limit);
  const items = await workItems(conn, ids);
  const byId = new Map(items.map((w) => [w.id, w]));
  const out: RemoteIssue[] = [];
  for (const id of ids) if (byId.has(id)) out.push(await toRemote(conn, byId.get(id)!));
  return out;
}

/** A project's iterations (classification nodes), as sprints: dates say which is current. */
async function iterations(conn: ProviderConnection, project: string): Promise<TrackerSprint[]> {
  const res = await conn.call({ method: 'GET', path: `/${seg(project)}/_apis/wit/classificationnodes/Iterations?$depth=10&${q(conn)}` });
  if (!ok(res)) throw refused(res, `list the iterations of ${project}`);
  const today = new Date().toISOString().slice(0, 10);
  const out: TrackerSprint[] = [];
  type Node = { id?: number; identifier?: string; name?: string; attributes?: { startDate?: string; finishDate?: string }; children?: Node[] };
  const walk = (n: Node, path: string[]) => {
    for (const c of n.children ?? []) {
      const p = [...path, String(c.name ?? '')];
      const start = c.attributes?.startDate?.slice(0, 10) ?? null;
      const end = c.attributes?.finishDate?.slice(0, 10) ?? null;
      out.push({ id: String(c.identifier ?? c.id), name: p.join('\\'), state: end && end < today ? 'closed' : start && start <= today ? 'active' : 'future', startDate: start, endDate: end });
      walk(c, p);
    }
  };
  walk(res.json as Node, []);
  const order = { closed: 0, active: 1, future: 2 };
  // An iteration without dates that holds others (a release) is no sprint of its own to plan in.
  return out.sort((a, b) => order[a.state] - order[b.state] || (a.startDate ?? '9').localeCompare(b.startDate ?? '9'));
}

/** The JSON Patch operations that write `values` (only those present), with notes for what can't be. */
async function operations(conn: ProviderConnection, values: IssueValues, ctx: { project: string; type: string; issue?: RemoteIssue }, notes: string[]) {
  const ops: Array<{ op: string; path: string; value?: unknown; from?: null }> = [];
  const set = (field: string, value: unknown) => ops.push({ op: 'add', path: `/fields/${field}`, value });
  if (values.title !== undefined) set('System.Title', values.title.replace(/\s+/g, ' ').trim().slice(0, 255) || 'Untitled');
  if (values.description !== undefined) set('System.Description', markdownToHtml(values.description));
  if (values.labels !== undefined) set('System.Tags', [...new Set(values.labels.map(azure.label).filter(Boolean))].join('; '));
  if (values.startDate !== undefined) set(START, values.startDate);
  if (values.dueDate !== undefined) set(TARGET, values.dueDate);
  if (values.priority) {
    if (PRIORITIES.includes(values.priority.trim())) set(PRIORITY, Number(values.priority.trim()));
    else notes.push(`${LABEL} priorities are 1 to 4, so “${values.priority}” wasn’t sent.`);
  }
  if (values.estimate !== undefined) {
    if (conn.settings.estimateField) set(conn.settings.estimateField, values.estimate);
    else if (values.estimate !== null) notes.push(`${LABEL} has no story points field Freero can find, so the estimate wasn’t sent.`);
  }
  if (values.assignee !== undefined) {
    // Azure DevOps resolves an identity by its sign-in address; '~' is someone it hides.
    if (values.assignee === null) set('System.AssignedTo', '');
    else if (!values.assignee.startsWith('~')) set('System.AssignedTo', values.assignee);
  }
  if (values.sprint !== undefined) {
    if (values.sprint === null) set('System.IterationPath', ctx.project);
    else {
      const hit = (await iterations(conn, ctx.project)).find((s) => labelKey(s.name) === labelKey(values.sprint!));
      if (!hit) notes.push(`${ctx.project} has no iteration “${values.sprint}” in ${LABEL}, so the iteration stayed.`);
      else if (hit.state === 'closed') notes.push(`“${hit.name}” is over in ${LABEL}, so the iteration stayed.`);
      else set('System.IterationPath', `${ctx.project}\\${hit.name}`);
    }
  }
  for (const [id, v] of Object.entries(values.custom ?? {})) {
    const m = mapOf(conn).find((x) => x.tracker === id);
    if (!m || v === undefined) continue;
    if (m.type === 'person' && typeof v === 'string' && v.startsWith('~')) continue;
    set(id, v === null ? '' : Array.isArray(v) ? v.join('; ') : m.type === 'text' ? String(v) : v);
  }
  // State: the one named like the card's column, else the first of the wanted category.
  if (values.statusName || values.status) {
    const list = await statesOf(conn, ctx.project, ctx.type);
    const current = ctx.issue?.values.statusName ?? null;
    const named = values.statusName ? list.find((s) => labelKey(s.name) === labelKey(values.statusName!)) : undefined;
    const want = values.status ?? null;
    const byCategory = want && ctx.issue?.values.status !== want ? CATEGORY_ORDER[want].map((c) => list.find((s) => s.category === c)).find(Boolean) : undefined;
    const target = named ?? byCategory;
    if (target && target.name !== current) set('System.State', target.name);
    else if (!target && want && ctx.issue?.values.status !== want) notes.push(`The ${ctx.type} type has no ${want === 'doing' ? 'in progress' : want === 'done' ? 'completed' : 'proposed'} state in ${LABEL}, so the state stayed.`);
  }
  return ops;
}

/** Sends a patch against revision `rev` (when given): a newer revision is a conflict, never overwritten. */
async function patchItem(conn: ProviderConnection, id: string, rev: string | null | undefined, ops: Array<Record<string, unknown>>, what: string): Promise<WorkItem> {
  const body = [...(rev ? [{ op: 'test', path: '/rev', value: Number(rev) }] : []), ...ops];
  const res = await conn.call({ method: 'PATCH', path: `/_apis/wit/workitems/${seg(id)}?${q(conn)}`, headers: PATCH, body });
  if (!ok(res)) throw refused(res, what);
  return res.json as WorkItem;
}

const itemOfUrl = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.searchParams.get('item') ?? u.searchParams.get('el');
  } catch {
    return null;
  }
};

const basicPassword = (header: string | string[] | undefined): string | null => {
  const h = Array.isArray(header) ? header[0] : header;
  const m = h ? /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(h.trim()) : null;
  if (!m) return null;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  return i >= 0 ? decoded.slice(i + 1) : null;
};

export const azure: TrackerProvider = {
  kind: 'azure',
  fields: ['title', 'description', 'status', 'statusName', 'priority', 'assignee', 'labels', 'startDate', 'dueDate', 'estimate', 'sprint'],
  queryLanguage: 'WIQL',
  parents: { issueType: 'Epic' },

  authHeaders(creds: Credentials) {
    if (creds.kind === 'oauth') return { authorization: `Bearer ${creds.accessToken}` };
    return { authorization: `Basic ${Buffer.from(`:${creds.token}`).toString('base64')}` };
  },

  async whoAmI(conn) {
    const me = await conn.call({ method: 'GET', path: `/_apis/connectionData?connectOptions=none&${q(conn)}` });
    // A wrong or expired PAT gets the sign-in page (203, HTML) instead of a 401 on some versions.
    if (!ok(me) || me.status === 203 || !me.json) throw refused(me.status === 203 || !me.json ? { ...me, status: 401 } : me, 'say who the connection is');
    const u = (me.json as { authenticatedUser?: { providerDisplayName?: string; properties?: { Account?: { $value?: string } } } }).authenticatedUser;
    const fields = await conn.call({ method: 'GET', path: `/_apis/wit/fields?${q(conn)}` });
    const refs = new Set(ok(fields) ? (((fields.json as { value?: unknown[] })?.value ?? []) as Array<{ referenceName?: string }>).map((f) => f.referenceName) : []);
    return {
      account: u?.properties?.Account?.$value ?? u?.providerDisplayName ?? 'Azure DevOps user',
      settings: { estimateField: ESTIMATE_FIELDS.find((f) => refs.has(f)) ?? null, startDateField: refs.has(START) ? START : null },
    };
  },

  async listProjects(conn) {
    const res = await conn.call({ method: 'GET', path: `/_apis/projects?$top=200&${q(conn)}` });
    if (!ok(res)) throw refused(res, 'list projects');
    return (((res.json as { value?: unknown[] })?.value ?? []) as Array<{ id?: string; name?: string }>)
      .filter((p) => p.name)
      .map((p) => ({ id: String(p.id ?? p.name), key: p.name!, name: p.name! }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async listFields(conn) {
    const res = await conn.call({ method: 'GET', path: `/_apis/wit/fields?${q(conn)}` });
    if (!ok(res)) throw refused(res, 'list its fields');
    const kind = (t: string | undefined, picklist: boolean): MappedFieldType | null => {
      if (picklist) return 'select';
      switch (t) {
        case 'string':
        case 'plainText':
        case 'html':
          return 'text';
        case 'integer':
        case 'double':
          return 'number';
        case 'dateTime':
          return 'date';
        case 'identity':
          return 'person';
        default:
          return null;
      }
    };
    const own = new Set(['System.Title', 'System.Description', 'System.Tags', 'System.AssignedTo', 'System.State', 'System.IterationPath', PRIORITY, START, TARGET, ...ESTIMATE_FIELDS]);
    return (((res.json as { value?: unknown[] })?.value ?? []) as Array<{ referenceName?: string; name?: string; type?: string; isPicklist?: boolean; readOnly?: boolean }>)
      .filter((f) => f.referenceName && f.name && !f.readOnly && !own.has(f.referenceName) && !f.referenceName.startsWith('System.'))
      .map((f): TrackerFieldInfo => ({ id: f.referenceName!, name: f.name!, type: kind(f.type, !!f.isPicklist) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async issueTypes(conn, project) {
    const res = await conn.call({ method: 'GET', path: `/${seg(project)}/_apis/wit/workitemtypes?${q(conn)}` });
    if (!ok(res)) throw refused(res, `list the work item types of ${project}`);
    return (((res.json as { value?: unknown[] })?.value ?? []) as Array<{ name?: unknown; isDisabled?: unknown }>).flatMap((t) => (typeof t.name === 'string' && !t.isDisabled ? [t.name] : []));
  },

  async getIssue(conn, id) {
    const w = await getWorkItem(conn, id);
    return w ? toRemote(conn, w) : null;
  },

  async createIssue(conn, input: CreateIssueInput) {
    const notes: string[] = [];
    const type = input.issueType || 'Task';
    const { status, statusName, ...rest } = input.values;
    const ops = await operations(conn, { ...rest, ...(rest.assignee === null ? { assignee: undefined } : {}) }, { project: input.project, type }, notes);
    if (input.parent) {
      const pid = input.parent.replace(/^#/, '');
      if (!/^\d{1,10}$/.test(pid)) throw new TrackerError(`${input.parent} isn’t a work item number.`, 'invalid', 400);
      ops.push({ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${conn.apiBase}/_apis/wit/workItems/${pid}` } });
    }
    const res = await conn.call({ method: 'POST', path: `/${seg(input.project)}/_apis/wit/workitems/$${seg(type)}?${q(conn)}`, headers: PATCH, body: ops });
    if (!ok(res)) throw refused(res, `create a ${type} in ${input.project}`);
    let w = res.json as WorkItem;
    let issue = await toRemote(conn, w);
    // The state after creating: a new work item starts in its type's first state.
    if (status || statusName) {
      const more = await operations(conn, { status, statusName }, { project: input.project, type, issue }, notes);
      if (more.length) {
        w = await patchItem(conn, issue.id, issue.version, more, `move ${issue.key}`);
        issue = await toRemote(conn, w);
      }
    }
    return { issue, notes };
  },

  async updateIssue(conn, issue, patch) {
    const notes: string[] = [];
    const project = issue.project ?? '';
    const type = (await getWorkItem(conn, issue.id).then((w) => (w ? String(w.fields['System.WorkItemType'] ?? 'Task') : 'Task'))) || 'Task';
    const ops = await operations(conn, patch, { project, type, issue }, notes);
    // Against the revision this sync READ (not the one just fetched for its type): anything
    // written in between is a conflict, merged by the next pass instead of overwritten.
    if (ops.length) await patchItem(conn, issue.id, issue.version, ops, `change ${issue.key}`);
    return notes;
  },

  async priorities() {
    return PRIORITIES;
  },

  async search(conn, query, limit) {
    return wiql(conn, query, limit);
  },

  sprints: { fieldName: 'Iteration', list: iterations },

  async scoped(conn, scope, limit) {
    const clauses = [`[System.TeamProject] = ${wiqlString(scope.project)}`];
    if (scope.sprint) {
      const hit = (await iterations(conn, scope.project)).find((s) => s.id === scope.sprint);
      if (!hit) throw new TrackerError(`${scope.project} has no such iteration.`, 'invalid', 400);
      clauses.push(`[System.IterationPath] = ${wiqlString(`${scope.project}\\${hit.name}`)}`);
    }
    if (scope.epic) {
      const pid = scope.epic.replace(/^#/, '');
      if (!/^\d{1,10}$/.test(pid)) throw new TrackerError(`${scope.epic} isn’t a work item number.`, 'invalid', 400);
      clauses.push(`[System.Parent] = ${pid}`);
    }
    return wiql(conn, `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(' AND ')} ORDER BY [System.Id]`, limit, scope.project);
  },

  async changedSince(conn, issues, since) {
    const ids = issues.map((i) => Number(i.id)).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) return [];
    const items = await workItems(conn, ids, ['System.Id', 'System.ChangedDate']);
    return items.filter((w) => (Date.parse(String(w.fields['System.ChangedDate'] ?? '')) || 0) >= since).map((w) => String(w.id));
  },

  async setBacklinks(conn, issue, links: Backlink[], removed) {
    const w = await getWorkItem(conn, issue.id);
    if (!w) throw new TrackerError(`${issue.key} no longer exists in ${LABEL}.`, 'not_found', 404);
    const rels = w.relations ?? [];
    const have = new Set(rels.filter((r) => r.rel === 'Hyperlink').map((r) => r.url));
    const ops: Array<Record<string, unknown>> = [];
    // Removals first, from the last index down (indexes shift).
    rels
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.rel === 'Hyperlink' && removed.includes(itemOfUrl(r.url) ?? ''))
      .reverse()
      .forEach(({ i }) => ops.push({ op: 'remove', path: `/relations/${i}` }));
    for (const l of links) if (!have.has(l.url)) ops.push({ op: 'add', path: '/relations/-', value: { rel: 'Hyperlink', url: l.url, attributes: { comment: `On a Freero board: ${l.title.slice(0, 200)}` } } });
    if (ops.length) await patchItem(conn, issue.id, String(w.rev), ops, `link ${issue.key} back to the board`);
  },

  label: (tag) => tag.replace(/;/g, ',').trim().slice(0, 400),

  webhook(d: WebhookDelivery) {
    // Service hooks can't sign; the delivery carries the connection's secret as its basic auth password.
    const given = basicPassword(d.headers.authorization);
    if (!given) return null;
    const a = Buffer.from(given);
    const b = Buffer.from(d.secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let body: { eventType?: string; resource?: { id?: unknown; workItemId?: unknown } } | null = null;
    try {
      body = JSON.parse(d.rawBody.toString('utf8'));
    } catch {
      return { issues: [] };
    }
    const r = body?.resource ?? {};
    // workitem.updated: the resource is the update, `workItemId` the work item; else the work item itself.
    const id = body?.eventType === 'workitem.updated' ? (r.workItemId ?? r.id) : (r.id ?? r.workItemId);
    return { issues: typeof id === 'number' || typeof id === 'string' ? [String(id)] : [] };
  },
};
