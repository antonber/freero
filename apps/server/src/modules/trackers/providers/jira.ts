// Jira Cloud and Jira Data Center / Server, through Jira's public REST API only.
//
//   Cloud        REST v3, descriptions in ADF; an API token with the account's email (Basic), or
//                OAuth 2.0 (3LO) through api.atlassian.com/ex/jira/<cloud id> (an app the
//                operator registers: TRACKER_JIRA_CLIENT_ID / _SECRET).
//   Data Center  REST v2, descriptions in wiki markup; a personal access token (Bearer).
//
// Differences handled here: description format, search (Cloud: POST /search/jql; DC: POST
// /search), user search (`query` vs `username`) and assignee ids (accountId vs name). Status
// changes go through the workflow's transitions: to the status of the same name when the board
// asks for one (a card moved to its "In review" column), else to the wanted category — when none
// leads there the sync says so instead of forcing anything. Priority is the issue's priority by
// name; the site's levels (GET /priority) become a kanban's Priority options on import. Story points live in a custom field found by name.
// Backlinks are remote links with a stable global id per board item. Webhooks are signed with
// the connection's secret (X-Hub-Signature: sha256=…), as Jira sends them for a webhook with a
// secret.
//
// Sprints (#119) are Jira Software's: an issue's sprint field (found by its schema when connecting)
// holds every sprint it was in, the open one is its sprint; moving it goes through the agile API
// (POST /rest/agile/1.0/sprint/{id}/issue, the backlog for none), a closed sprint is never a
// target. Mapped custom fields (#43: select, multi-select, number, date, text, user) are read and
// written by field id. A parent (an epic) is `fields.parent` on Cloud, the "Epic Link" field on Data
// Center when it has one.
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
  type TrackerSprint,
} from '@freero/shared';
import { getConfig } from '../../../platform/config';
import { trackerMessage, trackerRequest, TrackerError, type HttpResponse } from '../http';
import { adfToMarkdown, markdownToAdf, markdownToWiki, wikiToMarkdown } from '../markup';
import type { Backlink, CreateIssueInput, Credentials, OAuthProvider, ProviderConnection, RemoteIssue, TrackerProvider, WebhookDelivery } from './types';

const LABEL = TRACKER_PROVIDERS.jira;
const v = (conn: Pick<ProviderConnection, 'deployment'>) => (conn.deployment === 'datacenter' ? '2' : '3');
const cloud = (conn: Pick<ProviderConnection, 'deployment'>) => conn.deployment !== 'datacenter';

const CATEGORY: Record<string, IssueStatusCategory> = {
  new: 'todo',
  indeterminate: 'doing',
  done: 'done',
};
const CATEGORY_LABEL: Record<IssueStatusCategory, string> = {
  todo: 'To do',
  doing: 'In progress',
  done: 'Done',
};

/** Field names Jira gives story points (team-managed, company-managed, older sites). */
const ESTIMATE_FIELD_NAMES = ['story point estimate', 'story points', 'story point'];
/** Jira Cloud's start date is a custom field ("Start date"); found by name like story points. */
const START_FIELD_NAMES = ['start date', 'start'];
const SPRINT_SCHEMA = 'com.pyxis.greenhopper.jira:gh-sprint';
const EPIC_LINK_SCHEMA = 'com.pyxis.greenhopper.jira:gh-epic-link';
const KEY = /^[A-Z][A-Z0-9_]{0,49}$/i;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,49}-\d{1,9}$/i;

/** Turns a refused call into Freero's words. 404 is left to the caller. */
function refused(res: HttpResponse, what: string): TrackerError {
  const said = trackerMessage(res.json);
  if (res.status === 401) return new TrackerError(`${LABEL} refused the credentials. Check the connection.`, 'auth', 401);
  if (res.status === 403) return new TrackerError(`${LABEL} doesn’t allow this connection to ${what}${said ? ` (${said})` : ''}.`, 'refused', 403);
  if (res.status === 404) return new TrackerError(`${LABEL} couldn’t find what Freero asked for (${what}).`, 'not_found', 404);
  return new TrackerError(`${LABEL} refused to ${what}${said ? `: ${said}` : ` (${res.status})`}.`, 'invalid', res.status);
}
const ok = (res: HttpResponse) => res.status >= 200 && res.status < 300;

interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, unknown> & {
    summary?: string;
    description?: unknown;
    status?: { name?: string; statusCategory?: { key?: string } };
    priority?: { name?: string } | null;
    assignee?: {
      accountId?: string;
      name?: string;
      key?: string;
      emailAddress?: string;
      displayName?: string;
    } | null;
    labels?: string[];
    duedate?: string | null;
    updated?: string;
    project?: { key?: string; name?: string };
    parent?: { key?: string; fields?: { summary?: string } };
  };
}

const mapOf = (conn: ProviderConnection): FieldMapEntry[] => conn.settings.fieldMap ?? [];

const issueFields = (conn: ProviderConnection) =>
  [
    ...new Set([
      'summary',
      'description',
      'status',
      'priority',
      'assignee',
      'labels',
      'duedate',
      'updated',
      'project',
      'parent',
      ...(conn.settings.estimateField ? [conn.settings.estimateField] : []),
      ...(conn.settings.startDateField ? [conn.settings.startDateField] : []),
      ...(conn.settings.sprintField ? [conn.settings.sprintField] : []),
      ...mapOf(conn).map((m) => m.tracker),
    ]),
  ].join(',');

/** The sprints a sprint field's value names (objects on current sites, "…Sprint@1[id=1,state=ACTIVE,name=…]" strings on older Data Center). */
function sprintsIn(raw: unknown): Array<{ id: string; name: string; state: TrackerSprint['state'] }> {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.flatMap((s) => {
    if (s && typeof s === 'object') {
      const o = s as { id?: unknown; name?: unknown; state?: unknown };
      return o.id !== undefined && typeof o.name === 'string' ? [{ id: String(o.id), name: o.name, state: sprintState(o.state) }] : [];
    }
    if (typeof s !== 'string') return [];
    const field = (k: string) => new RegExp(`[\\[,]${k}=([^,\\]]*)`).exec(s)?.[1];
    const id = field('id');
    const name = field('name');
    return id && name ? [{ id, name, state: sprintState(field('state')) }] : [];
  });
}
const sprintState = (s: unknown): TrackerSprint['state'] => (String(s).toLowerCase() === 'active' ? 'active' : String(s).toLowerCase() === 'closed' ? 'closed' : 'future');

/** An issue's sprint: the open one it is in (active before future), else the last closed one. */
function currentSprint(raw: unknown): string | null {
  const all = sprintsIn(raw);
  return (all.find((s) => s.state === 'active') ?? all.find((s) => s.state === 'future') ?? all.at(-1))?.name ?? null;
}

/** A mapped Jira field's value in the board's terms. */
function customOf(conn: ProviderConnection, type: MappedFieldType, raw: unknown): CustomValue {
  if (raw === null || raw === undefined) return type === 'multiselect' ? [] : null;
  const label = (x: unknown) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as { value?: unknown; name?: unknown }).value ?? (x as { name?: unknown }).name ?? '') : String(x));
  switch (type) {
    case 'select':
      return label(raw) || null;
    case 'multiselect':
      return (Array.isArray(raw) ? raw : [raw]).map(label).filter(Boolean);
    case 'number':
      return typeof raw === 'number' ? raw : Number.isFinite(Number(raw)) ? Number(raw) : null;
    case 'date':
      return typeof raw === 'string' ? raw.slice(0, 10) : null;
    case 'person': {
      const u = raw as { emailAddress?: string; accountId?: string; name?: string };
      return u.emailAddress?.toLowerCase() ?? `~${u.accountId ?? u.name ?? 'someone'}`;
    }
    default:
      return typeof raw === 'string' ? raw : cloud(conn) ? adfToMarkdown(raw) || null : null;
  }
}

function toRemote(conn: ProviderConnection, j: JiraIssue): RemoteIssue {
  const f = j.fields ?? {};
  const assignee = f.assignee ?? null;
  const cat = f.status?.statusCategory?.key ? (CATEGORY[f.status.statusCategory.key] ?? null) : null;
  const est = conn.settings.estimateField ? f[conn.settings.estimateField] : null;
  const start = conn.settings.startDateField ? f[conn.settings.startDateField] : undefined;
  return {
    id: String(j.id),
    key: String(j.key),
    url: `${conn.site.replace(/\/+$/, '')}/browse/${encodeURIComponent(j.key)}`,
    values: {
      title: typeof f.summary === 'string' ? f.summary : '',
      description: cloud(conn) ? adfToMarkdown(f.description) : wikiToMarkdown(f.description),
      status: cat,
      statusName: f.status?.name ?? null,
      priority: typeof f.priority?.name === 'string' ? f.priority.name : null,
      // An assignee whose email Jira hides (Cloud privacy settings) is told apart by id.
      assignee: assignee ? (assignee.emailAddress?.toLowerCase() ?? `~${assignee.accountId ?? assignee.name ?? assignee.key ?? 'someone'}`) : null,
      labels: Array.isArray(f.labels) ? f.labels.filter((l): l is string => typeof l === 'string') : [],
      ...(conn.settings.startDateField ? { startDate: typeof start === 'string' ? start.slice(0, 10) : null } : {}),
      dueDate: typeof f.duedate === 'string' ? f.duedate.slice(0, 10) : null,
      estimate: typeof est === 'number' ? est : null,
      ...(conn.settings.sprintField ? { sprint: currentSprint(f[conn.settings.sprintField]) } : {}),
      ...(mapOf(conn).length ? { custom: Object.fromEntries(mapOf(conn).map((m) => [m.tracker, customOf(conn, m.type, f[m.tracker])])) } : {}),
    },
    assigneeName: assignee?.displayName ?? null,
    updatedAt: f.updated ? Date.parse(f.updated) || 0 : 0,
    groups: { team: f.project?.name ?? f.project?.key ?? null, epic: f.parent?.fields?.summary ?? f.parent?.key ?? null },
    project: f.project?.key ?? (String(j.key).includes('-') ? String(j.key).replace(/-\d+$/, '') : null),
  };
}

/** A project's sprints, through the agile API: those of its scrum boards, oldest first. */
async function projectSprints(conn: ProviderConnection, project: string): Promise<TrackerSprint[]> {
  if (!KEY.test(project)) throw new TrackerError(`${project} isn’t a ${LABEL} project key.`, 'invalid', 400);
  const boards = await conn.call({ method: 'GET', path: `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(project)}&maxResults=50` });
  if (boards.status === 404) throw new TrackerError(`${LABEL} has no sprints here (Jira Software isn’t on this site).`, 'invalid', 404);
  if (!ok(boards)) throw refused(boards, 'list the project’s boards');
  const out = new Map<string, TrackerSprint>();
  for (const b of ((boards.json as { values?: unknown[] })?.values ?? []) as Array<{ id?: unknown; type?: unknown }>) {
    if (b.id === undefined || (b.type !== undefined && b.type !== 'scrum')) continue;
    for (let startAt = 0; startAt < 500; ) {
      const res = await conn.call({ method: 'GET', path: `/rest/agile/1.0/board/${encodeURIComponent(String(b.id))}/sprint?maxResults=50&startAt=${startAt}` });
      if (!ok(res)) break;
      const page = res.json as { values?: Array<{ id?: unknown; name?: unknown; state?: unknown; startDate?: unknown; endDate?: unknown }>; isLast?: boolean };
      const values = page?.values ?? [];
      for (const s of values)
        if (s.id !== undefined && typeof s.name === 'string')
          out.set(String(s.id), {
            id: String(s.id),
            name: s.name,
            state: sprintState(s.state),
            startDate: typeof s.startDate === 'string' ? s.startDate.slice(0, 10) : null,
            endDate: typeof s.endDate === 'string' ? s.endDate.slice(0, 10) : null,
          });
      if (page?.isLast !== false || !values.length) break;
      startAt += values.length;
    }
  }
  const order = { closed: 0, active: 1, future: 2 };
  return [...out.values()].sort((a, b) => order[a.state] - order[b.state] || (a.startDate ?? '9').localeCompare(b.startDate ?? '9') || Number(a.id) - Number(b.id));
}

/** Puts the issue in the sprint named `name` (a closed one never), or in the backlog for null. */
async function moveToSprint(conn: ProviderConnection, issue: RemoteIssue, name: string | null, notes: string[]): Promise<void> {
  if (!conn.settings.sprintField) {
    if (name) notes.push(`${LABEL} has no sprints on this site, so the sprint wasn’t sent.`);
    return;
  }
  if (name === null) {
    const res = await conn.call({ method: 'POST', path: '/rest/agile/1.0/backlog/issue', body: { issues: [issue.key] } });
    if (!ok(res)) throw refused(res, `move ${issue.key} to the backlog`);
    return;
  }
  const sprints = issue.project ? await projectSprints(conn, issue.project) : [];
  const hit = sprints.find((s) => labelKey(s.name) === labelKey(name));
  if (!hit) return void notes.push(`${issue.project ?? 'The project'} has no sprint “${name}” in ${LABEL}, so ${issue.key}’s sprint stayed.`);
  if (hit.state === 'closed') return void notes.push(`“${hit.name}” is closed in ${LABEL}, so ${issue.key}’s sprint stayed.`);
  const res = await conn.call({ method: 'POST', path: `/rest/agile/1.0/sprint/${encodeURIComponent(hit.id)}/issue`, body: { issues: [issue.key] } });
  if (!ok(res)) throw refused(res, `move ${issue.key} to ${hit.name}`);
}

/** Jira's user for an email address (only an exact address match counts). */
async function findUser(conn: ProviderConnection, email: string): Promise<Record<string, string> | null> {
  const q = cloud(conn) ? `query=${encodeURIComponent(email)}` : `username=${encodeURIComponent(email)}`;
  const res = await conn.call({
    method: 'GET',
    path: `/rest/api/${v(conn)}/user/search?${q}&maxResults=5`,
  });
  if (!ok(res) || !Array.isArray(res.json)) return null;
  const users = res.json as Array<{
    accountId?: string;
    name?: string;
    emailAddress?: string;
  }>;
  const hit = users.find((u) => u.emailAddress?.toLowerCase() === email) ?? (users.length === 1 && !users[0].emailAddress ? users[0] : null);
  if (!hit) return null;
  return cloud(conn) ? (hit.accountId ? { accountId: hit.accountId } : null) : hit.name ? { name: hit.name } : null;
}

/** Jira `fields` for the values present in `values` (status goes through transitions instead). */
async function fieldsFor(conn: ProviderConnection, values: IssueValues, notes: string[]): Promise<Record<string, unknown>> {
  const f: Record<string, unknown> = {};
  if (values.title !== undefined) f.summary = values.title.replace(/\s+/g, ' ').trim().slice(0, 255) || 'Untitled';
  if (values.description !== undefined) f.description = cloud(conn) ? markdownToAdf(values.description) : markdownToWiki(values.description);
  if (values.labels !== undefined) f.labels = [...new Set(values.labels.map(jira.label).filter(Boolean))];
  if (values.dueDate !== undefined) f.duedate = values.dueDate;
  // Jira keeps a priority on every issue (its scheme's default): clearing it on the board leaves Jira's.
  if (values.priority) f.priority = { name: values.priority };
  if (values.startDate !== undefined) {
    if (conn.settings.startDateField) f[conn.settings.startDateField] = values.startDate;
    else if (values.startDate !== null) notes.push(`${LABEL} has no start date field Freero can find, so the start date wasn’t sent.`);
  }
  if (values.estimate !== undefined) {
    if (conn.settings.estimateField) f[conn.settings.estimateField] = values.estimate;
    else if (values.estimate !== null) notes.push(`${LABEL} has no story points field Freero can find, so the estimate wasn’t sent.`);
  }
  if (values.assignee !== undefined) {
    if (values.assignee === null) f.assignee = null;
    else if (!values.assignee.startsWith('~')) {
      const user = await findUser(conn, values.assignee);
      if (user) f.assignee = user;
      else notes.push(`No ${LABEL} user has the address ${values.assignee}, so the issue was left unassigned there.`);
    }
  }
  for (const [id, v] of Object.entries(values.custom ?? {})) {
    const m = mapOf(conn).find((x) => x.tracker === id);
    if (!m || v === undefined) continue;
    if (v === null || (Array.isArray(v) && !v.length)) f[id] = m.type === 'multiselect' ? [] : null;
    else if (m.type === 'select') f[id] = { value: String(v) };
    else if (m.type === 'multiselect') f[id] = (Array.isArray(v) ? v : [v]).map((x) => ({ value: String(x) }));
    else if (m.type === 'person') {
      if (String(v).startsWith('~')) continue;
      const user = await findUser(conn, String(v).toLowerCase());
      if (user) f[id] = user;
      else notes.push(`No ${LABEL} user has the address ${v}, so ${m.trackerName} stayed.`);
    } else f[id] = v;
  }
  return f;
}

/** Field ids a 400 names (create/edit screens that lack a field). */
const rejectedFields = (res: HttpResponse): string[] => {
  const errs = (res.json as { errors?: Record<string, unknown> } | null)?.errors;
  return errs && typeof errs === 'object' ? Object.keys(errs) : [];
};
const FIELD_NAMES: Record<string, string> = {
  summary: 'title',
  description: 'description',
  labels: 'labels',
  duedate: 'due date',
  assignee: 'assignee',
  priority: 'priority',
};

/** Sends `fields`, and once more without what Jira refuses (a field not on the screen). */
async function sendFields(
  conn: ProviderConnection,
  send: (fields: Record<string, unknown>) => Promise<HttpResponse>,
  fields: Record<string, unknown>,
  notes: string[],
  what: string,
): Promise<HttpResponse> {
  let res = await send(fields);
  if (res.status === 400) {
    const bad = rejectedFields(res).filter((k) => k in fields && k !== 'summary' && k !== 'project' && k !== 'issuetype');
    if (bad.length) {
      const rest = { ...fields };
      for (const k of bad) delete rest[k];
      const nameOf = (k: string) => FIELD_NAMES[k] ?? (k === conn.settings.estimateField ? 'the estimate' : (mapOf(conn).find((m) => m.tracker === k)?.trackerName ?? k));
      notes.push(`${LABEL} didn’t accept ${bad.map(nameOf).join(', ')} on this issue (not on its screen), so ${bad.length === 1 ? 'it was' : 'they were'} left out.`);
      res = await send(rest);
    }
  }
  if (!ok(res)) throw refused(res, what);
  return res;
}

/**
 * Moves the issue through its workflow: to the status named `want.name` when a transition leads
 * there (case and spaces don't count), else to one in `want.category`. A name the workflow has
 * no transition to (a column only the board has) asks for nothing beyond its category.
 */
async function transition(conn: ProviderConnection, issue: RemoteIssue, want: { category?: IssueStatusCategory | null; name?: string | null }, notes: string[]): Promise<void> {
  const name = want.name?.trim() ? labelKey(want.name) : null;
  if (name && labelKey(issue.values.statusName ?? '') === name) return;
  const category = want.category && want.category !== issue.values.status ? want.category : null;
  if (!name && !category) return;
  const res = await conn.call({
    method: 'GET',
    path: `/rest/api/${v(conn)}/issue/${encodeURIComponent(issue.id)}/transitions`,
  });
  if (!ok(res)) throw refused(res, 'read the issue’s workflow');
  const ts = ((res.json as { transitions?: unknown[] })?.transitions ?? []) as Array<{
    id: string;
    name?: string;
    to?: { name?: string; statusCategory?: { key?: string } };
  }>;
  const named = name ? ts.find((t) => labelKey(t.to?.name ?? '') === name) : undefined;
  const hit = named ?? (category ? ts.find((t) => t.to?.statusCategory?.key && CATEGORY[t.to.statusCategory.key] === category) : undefined);
  if (!hit) {
    if (category)
      notes.push(
        `The ${LABEL} workflow has no transition from “${issue.values.statusName ?? 'its status'}” to ${CATEGORY_LABEL[category].toLowerCase()} for ${issue.key}, so its status stayed.`,
      );
    return;
  }
  const done = await conn.call({
    method: 'POST',
    path: `/rest/api/${v(conn)}/issue/${encodeURIComponent(issue.id)}/transitions`,
    body: { transition: { id: hit.id } },
  });
  if (!ok(done)) throw refused(done, `move ${issue.key} to ${hit.to?.name ?? (category ? CATEGORY_LABEL[category] : want.name)}`);
}

const hmacOk = (secret: string, body: Buffer, given: string | undefined): boolean => {
  if (!given) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(given.trim());
  if (!m) return false;
  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(m[1], 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
};

export const jira: TrackerProvider = {
  kind: 'jira',
  fields: ['title', 'description', 'status', 'statusName', 'priority', 'assignee', 'labels', 'startDate', 'dueDate', 'estimate', 'sprint'],
  queryLanguage: 'JQL',
  parents: { issueType: 'Epic' },

  authHeaders(creds: Credentials) {
    if (creds.kind === 'oauth') return { authorization: `Bearer ${creds.accessToken}` };
    // Cloud API tokens go with the account's email (Basic); Data Center PATs are bearer tokens.
    return creds.email
      ? {
          authorization: `Basic ${Buffer.from(`${creds.email}:${creds.token}`).toString('base64')}`,
        }
      : { authorization: `Bearer ${creds.token}` };
  },

  async whoAmI(conn) {
    const me = await conn.call({
      method: 'GET',
      path: `/rest/api/${v(conn)}/myself`,
    });
    if (!ok(me)) throw refused(me, 'say who the connection is');
    const j = me.json as {
      displayName?: string;
      emailAddress?: string;
      name?: string;
    };
    const fields = await conn.call({
      method: 'GET',
      path: `/rest/api/${v(conn)}/field`,
    });
    let estimateField: string | null = null;
    let startDateField: string | null = null;
    let sprintField: string | null = null;
    let epicLinkField: string | null = null;
    if (ok(fields) && Array.isArray(fields.json)) {
      const list = fields.json as Array<{ id?: string; name?: string; schema?: { custom?: string } }>;
      sprintField = list.find((f) => f.id && (f.schema?.custom === SPRINT_SCHEMA || (!f.schema?.custom && f.name?.trim().toLowerCase() === 'sprint')))?.id ?? null;
      epicLinkField = list.find((f) => f.id && (f.schema?.custom === EPIC_LINK_SCHEMA || f.name?.trim().toLowerCase() === 'epic link'))?.id ?? null;
      for (const name of START_FIELD_NAMES) {
        const hit = list.find((f) => f.name?.trim().toLowerCase() === name && f.id);
        if (hit) {
          startDateField = hit.id!;
          break;
        }
      }
      for (const name of ESTIMATE_FIELD_NAMES) {
        const hit = list.find((f) => f.name?.trim().toLowerCase() === name && f.id);
        if (hit) {
          estimateField = hit.id!;
          break;
        }
      }
    }
    return {
      account: j.emailAddress ?? j.displayName ?? j.name ?? 'Jira user',
      settings: { estimateField, startDateField, sprintField, epicLinkField },
    };
  },

  async listFields(conn) {
    const res = await conn.call({ method: 'GET', path: `/rest/api/${v(conn)}/field` });
    if (!ok(res) || !Array.isArray(res.json)) throw refused(res, 'list its fields');
    const kind = (s: { type?: string; items?: string; custom?: string } | undefined): MappedFieldType | null => {
      if (!s?.type || s.custom === SPRINT_SCHEMA || s.custom === EPIC_LINK_SCHEMA) return null;
      if (s.type === 'option') return 'select';
      if (s.type === 'array' && (s.items === 'option' || s.items === 'string')) return 'multiselect';
      if (s.type === 'number') return 'number';
      if (s.type === 'date' || s.type === 'datetime') return 'date';
      if (s.type === 'string') return 'text';
      if (s.type === 'user') return 'person';
      return null;
    };
    return (res.json as Array<{ id?: string; name?: string; custom?: boolean; schema?: { type?: string; items?: string; custom?: string } }>)
      .filter((f) => f.id && f.name && (f.custom ?? f.id.startsWith('customfield_')))
      .map((f): TrackerFieldInfo => ({ id: f.id!, name: f.name!, type: kind(f.schema) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async issueTypes(conn, project) {
    if (!KEY.test(project)) throw new TrackerError(`${project} isn’t a ${LABEL} project key.`, 'invalid', 400);
    const res = await conn.call({ method: 'GET', path: `/rest/api/${v(conn)}/issue/createmeta/${encodeURIComponent(project)}/issuetypes?maxResults=100` });
    if (!ok(res)) throw refused(res, `list the issue types of ${project}`);
    const j = res.json as { issueTypes?: unknown[]; values?: unknown[] } | null;
    return ((j?.issueTypes ?? j?.values ?? []) as Array<{ name?: unknown; subtask?: unknown }>).flatMap((t) => (typeof t.name === 'string' && !t.subtask ? [t.name] : []));
  },

  sprints: { fieldName: 'Sprint', list: projectSprints },

  async scoped(conn, scope, limit) {
    if (!KEY.test(scope.project)) throw new TrackerError(`${scope.project} isn’t a ${LABEL} project key.`, 'invalid', 400);
    const clauses = [`project = "${scope.project}"`];
    if (scope.sprint) {
      if (!/^\d{1,12}$/.test(scope.sprint)) throw new TrackerError('That isn’t one of the project’s sprints.', 'invalid', 400);
      clauses.push(`sprint = ${scope.sprint}`);
    }
    if (scope.epic) {
      if (!ISSUE_KEY.test(scope.epic)) throw new TrackerError(`${scope.epic} isn’t a ${LABEL} issue key.`, 'invalid', 400);
      clauses.push(cloud(conn) || !conn.settings.epicLinkField ? `parent = ${scope.epic}` : `"Epic Link" = ${scope.epic}`);
    }
    return jira.search(conn, clauses.join(' AND '), limit);
  },

  async listProjects(conn) {
    const res = cloud(conn)
      ? await conn.call({
          method: 'GET',
          path: `/rest/api/3/project/search?maxResults=100&orderBy=key`,
        })
      : await conn.call({ method: 'GET', path: `/rest/api/2/project` });
    if (!ok(res)) throw refused(res, 'list projects');
    const list = (cloud(conn) ? (res.json as { values?: unknown[] })?.values : res.json) as Array<{ id?: string; key?: string; name?: string }> | undefined;
    return (list ?? [])
      .filter((p) => p.key)
      .map((p): TrackerProject => ({
        id: String(p.id ?? p.key),
        key: String(p.key),
        name: String(p.name ?? p.key),
      }));
  },

  async getIssue(conn, id) {
    const res = await conn.call({
      method: 'GET',
      path: `/rest/api/${v(conn)}/issue/${encodeURIComponent(id)}?fields=${issueFields(conn)}`,
    });
    if (res.status === 404) return null;
    if (!ok(res)) throw refused(res, 'read the issue');
    return toRemote(conn, res.json as JiraIssue);
  },

  async createIssue(conn, input: CreateIssueInput) {
    const notes: string[] = [];
    const { status, statusName, sprint, ...rest } = input.values;
    if (input.parent && !ISSUE_KEY.test(input.parent)) throw new TrackerError(`${input.parent} isn’t a ${LABEL} issue key.`, 'invalid', 400);
    const epicLink = !cloud(conn) && conn.settings.epicLinkField ? conn.settings.epicLinkField : null;
    const fields = {
      project: { key: input.project },
      issuetype: { name: input.issueType || 'Task' },
      ...(input.parent ? (epicLink ? { [epicLink]: input.parent } : { parent: { key: input.parent } }) : {}),
      ...(await fieldsFor(conn, { ...rest, ...(rest.assignee === null ? { assignee: undefined } : {}) }, notes)),
    };
    const res = await sendFields(
      conn,
      (f) =>
        conn.call({
          method: 'POST',
          path: `/rest/api/${v(conn)}/issue`,
          body: { fields: f },
        }),
      fields,
      notes,
      `create an issue in ${input.project}`,
    );
    const created = res.json as { id?: string; key?: string };
    if (!created?.id) throw new TrackerError(`${LABEL} didn’t say which issue it created.`, 'invalid');
    let issue = await jira.getIssue(conn, String(created.id));
    if (!issue) throw new TrackerError(`${LABEL} created ${created.key ?? 'an issue'} but Freero can’t read it back.`, 'refused');
    if (status || statusName || sprint) {
      if (status || statusName) await transition(conn, issue, { category: status, name: statusName }, notes);
      if (sprint) await moveToSprint(conn, issue, sprint, notes);
      issue = (await jira.getIssue(conn, issue.id)) ?? issue;
    }
    return { issue, notes };
  },

  async updateIssue(conn, issue, patch) {
    const notes: string[] = [];
    const { status, statusName, sprint, ...rest } = patch;
    const fields = await fieldsFor(conn, rest, notes);
    if (Object.keys(fields).length)
      await sendFields(
        conn,
        (f) =>
          conn.call({
            method: 'PUT',
            path: `/rest/api/${v(conn)}/issue/${encodeURIComponent(issue.id)}`,
            body: { fields: f },
          }),
        fields,
        notes,
        `change ${issue.key}`,
      );
    if (status || statusName) await transition(conn, issue, { category: status, name: statusName }, notes);
    if (sprint !== undefined) await moveToSprint(conn, issue, sprint, notes);
    return notes;
  },


  async priorities(conn) {
    const res = await conn.call({ method: 'GET', path: `/rest/api/${v(conn)}/priority` });
    if (!ok(res) || !Array.isArray(res.json)) return null;
    return (res.json as Array<{ name?: unknown }>).flatMap((p) => (typeof p.name === 'string' && p.name.trim() ? [p.name.trim()] : []));
  },

  async search(conn, query, limit) {
    const body = {
      jql: query,
      fields: issueFields(conn).split(','),
      maxResults: Math.min(100, limit),
    };
    const res = cloud(conn)
      ? await conn.call({
          method: 'POST',
          path: '/rest/api/3/search/jql',
          body,
        })
      : await conn.call({ method: 'POST', path: '/rest/api/2/search', body });
    if (res.status === 400) throw new TrackerError(`${LABEL} couldn’t run that JQL${trackerMessage(res.json) ? `: ${trackerMessage(res.json)}` : '.'}`, 'invalid', 400);
    if (!ok(res)) throw refused(res, 'search issues');
    return (((res.json as { issues?: unknown[] })?.issues ?? []) as JiraIssue[]).slice(0, limit).map((j) => toRemote(conn, j));
  },

  async changedSince(conn, issues, since) {
    const out: string[] = [];
    // Relative minutes: JQL dates are read in the API user's time zone, "-Nm" is not.
    const minutes = Math.max(1, Math.ceil((Date.now() - since) / 60_000) + 1);
    for (let i = 0; i < issues.length; i += 100) {
      const ids = issues
        .slice(i, i + 100)
        .map((x) => x.id)
        .filter((id) => /^\d+$/.test(id));
      if (!ids.length) continue;
      const found = await jira.search(conn, `id in (${ids.join(',')}) AND updated >= "-${minutes}m"`, 100);
      out.push(...found.map((f) => f.id));
    }
    return out;
  },

  async setBacklinks(conn, issue, links: Backlink[], removed) {
    for (const l of links) {
      const res = await conn.call({
        method: 'POST',
        path: `/rest/api/${v(conn)}/issue/${encodeURIComponent(issue.id)}/remotelink`,
        body: {
          globalId: `freero-item=${l.itemId}`,
          application: { type: 'app.freero', name: 'Freero' },
          relationship: 'on a Freero board',
          object: {
            url: l.url,
            title: l.title,
            icon: {
              url16x16: `${new URL(l.url).origin}/freero.svg`,
              title: 'Freero',
            },
          },
        },
      });
      if (!ok(res)) throw refused(res, `link ${issue.key} back to the board`);
    }
    for (const itemId of removed) {
      const res = await conn.call({
        method: 'DELETE',
        path: `/rest/api/${v(conn)}/issue/${encodeURIComponent(issue.id)}/remotelink?globalId=${encodeURIComponent(`freero-item=${itemId}`)}`,
      });
      if (!ok(res) && res.status !== 404) throw refused(res, `remove a link from ${issue.key}`);
    }
  },

  label: (tag) => tag.trim().replace(/\s+/g, '-').slice(0, 255),

  webhook(d: WebhookDelivery) {
    const sig = d.headers['x-hub-signature'];
    if (!hmacOk(d.secret, d.rawBody, Array.isArray(sig) ? sig[0] : sig)) return null;
    let body: { issue?: { id?: unknown; key?: unknown } } | null = null;
    try {
      body = JSON.parse(d.rawBody.toString('utf8'));
    } catch {
      return { issues: [] };
    }
    const issue = body?.issue;
    return {
      issues: [issue?.id, issue?.key].filter((x): x is string | number => typeof x === 'string' || typeof x === 'number').map(String),
    };
  },
};

// ---- OAuth 2.0 (3LO), Jira Cloud ----

const oauthUrls = () => {
  const c = getConfig().trackers;
  return {
    auth: c.jiraAuthUrl.replace(/\/+$/, ''),
    api: c.jiraApiUrl.replace(/\/+$/, ''),
  };
};

const SCOPES = 'read:jira-work write:jira-work read:jira-user offline_access';

async function tokenCall(body: Record<string, string>): Promise<Extract<Credentials, { kind: 'oauth' }>> {
  const allowPrivate = getConfig().trackers.privateEndpoints;
  const res = await trackerRequest({ method: 'POST', url: `${oauthUrls().auth}/oauth/token`, body }, { allowPrivate });
  const j = res.json as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  } | null;
  if (!ok(res) || !j?.access_token)
    throw new TrackerError(`Atlassian refused the authorization${trackerMessage(res.json) ? `: ${trackerMessage(res.json)}` : '.'}`, 'auth', res.status);
  return {
    kind: 'oauth',
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? body.refresh_token ?? null,
    expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : null,
  };
}

export const jiraOAuth: OAuthProvider = {
  kind: 'jira',
  authorizeUrl({ clientId, redirectUri, state }) {
    const q = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      prompt: 'consent',
    });
    return `${oauthUrls().auth}/authorize?${q}`;
  },
  async redeem({ clientId, clientSecret, redirectUri, code }) {
    const credentials = await tokenCall({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    });
    const res = await trackerRequest(
      {
        method: 'GET',
        url: `${oauthUrls().api}/oauth/token/accessible-resources`,
        headers: { authorization: `Bearer ${credentials.accessToken}` },
      },
      { allowPrivate: getConfig().trackers.privateEndpoints },
    );
    if (!ok(res) || !Array.isArray(res.json)) throw new TrackerError('Atlassian didn’t list the sites this authorization reaches.', 'auth', res.status);
    const sites = (res.json as Array<{ id?: string; url?: string; name?: string }>)
      .filter((s) => s.id && s.url)
      .map((s) => ({
        site: s.url!.replace(/\/+$/, ''),
        apiBase: `${oauthUrls().api}/ex/jira/${encodeURIComponent(s.id!)}`,
        name: s.name ?? s.url!,
      }));
    return { credentials, sites };
  },
  refresh({ clientId, clientSecret, refreshToken }) {
    return tokenCall({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });
  },
};
