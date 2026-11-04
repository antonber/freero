// GitHub Issues (github.com and GitHub Enterprise Server: its API at https://<host>/api/v3, GraphQL
// at /api/graphql) with a token (a fine-grained personal access token or an installation token).
// "Projects" are repositories (owner/name); an issue's id is "owner/name#number".
//
// Freero writes only a MANAGED SECTION of the issue body, between markers, holding the
// description it made and the links back to the board items — whatever people write outside the
// markers is never touched. Open / closed is the status.
//
// GitHub Projects (#42). An issue in a Project (v2) — the connection's planning Project
// ("acme/3", set in its field map), else the first Project it is in — also syncs that Project's
// fields, found by name unless a manager picked them: **Status** (single select) ↔ the kanban
// column (a done option, or the issue closed, is done), a number field (Estimate, Points, Story
// points, Size) ↔ the estimate, an **Iteration** field ↔ the kanban's Iteration (sprints),
// **Start date** ↔ the start date and **Target date** (End / Due date) ↔ the due date; mapped
// fields (#43) by the Project field's id. Without a target date field the due date is the
// **milestone's**: read from its due date, written by moving the issue to the open milestone due
// that day (none: a note). Assignees: the issue's first assignee by login — a Freero person when
// they connected their own GitHub (Settings), else by the public email of the GitHub profile, else
// "~login"; written by adding / removing just that login. Sub-issues (`parents`): new issues go
// under a parent issue, and an import by parent brings its sub-issues.
//
// Writes name only what changed: a PATCH of those fields (the body only when the description
// changed), labels and assignees added / removed one by one, one mutation per Project field.
// Webhooks carry X-Hub-Signature-256 (HMAC-SHA256 of the body with the connection's secret);
// Project field changes don't reach a repository's webhooks, so polling also reads the planning
// Project's items updated since.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { labelKey, TRACKER_PROVIDERS, type CustomValue, type FieldMapEntry, type IssueStatusCategory, type IssueValues, type MappedFieldType, type TrackerFieldInfo, type TrackerSprint } from '@freero/shared';
import { trackerMessage, TrackerError, type HttpResponse } from '../http';
import type { Backlink, CreateIssueInput, Credentials, ProviderConnection, RemoteIssue, TrackerProvider } from './types';

const LABEL = TRACKER_PROVIDERS.github;
export const BEGIN = '<!-- freero:begin (Freero keeps this part in sync with the board) -->';
export const END = '<!-- freero:end -->';
const LINKS_PREFIX = 'On the Freero board: ';
const REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

interface GhUser {
  login: string;
  email?: string | null;
}

interface GhIssue {
  id?: number;
  node_id?: string;
  number: number;
  html_url: string;
  title?: string;
  body?: string | null;
  state?: 'open' | 'closed';
  labels?: Array<string | { name?: string }>;
  assignees?: GhUser[];
  updated_at?: string;
  repository_url?: string;
  pull_request?: unknown;
  milestone?: { number?: number; title?: string; due_on?: string | null } | null;
}

const ok = (res: HttpResponse) => res.status >= 200 && res.status < 300;
function refused(res: HttpResponse, what: string): TrackerError {
  const said = trackerMessage(res.json);
  if (res.status === 401) return new TrackerError(`${LABEL} refused the token. Check the connection.`, 'auth', 401);
  if (res.status === 403) return new TrackerError(`${LABEL} doesn’t allow this token to ${what}${said ? ` (${said})` : ''}.`, 'refused', 403);
  if (res.status === 404) return new TrackerError(`${LABEL} couldn’t find it (${what}).`, 'not_found', 404);
  return new TrackerError(`${LABEL} refused to ${what}${said ? `: ${said}` : ` (${res.status})`}.`, 'invalid', res.status);
}

/** "owner/name#12" → its parts. */
function parseId(id: string): { repo: string; number: number } {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(id);
  if (!m) throw new TrackerError(`“${id}” is not a ${LABEL} issue.`, 'invalid', 400);
  return { repo: m[1], number: Number(m[2]) };
}

/** An issue from what people type: "#12" (in `repo`), "owner/name#12", or its address. */
export function githubIssueRef(s: string, repo: string | null): { repo: string; number: number } | null {
  const t = s.trim();
  let m = /^#?(\d{1,9})$/.exec(t);
  if (m && repo && REPO.test(repo)) return { repo, number: Number(m[1]) };
  m = /^([\w.-]+\/[\w.-]+)#(\d{1,9})$/.exec(t);
  if (m) return { repo: m[1], number: Number(m[2]) };
  m = /\/([\w.-]+\/[\w.-]+)\/issues\/(\d{1,9})(?:[/?#].*)?$/.exec(t);
  return m ? { repo: m[1], number: Number(m[2]) } : null;
}

/** The managed section of a body (what Freero wrote), or the whole body when there is none. */
export function managedPart(body: string): {
  description: string;
  links: string;
} {
  const a = body.indexOf(BEGIN);
  const b = body.indexOf(END);
  const inner = a >= 0 && b > a ? body.slice(a + BEGIN.length, b) : body;
  const lines = inner.replace(/\r\n?/g, '\n').trim().split('\n');
  const at = lines.findIndex((l) => l.startsWith(LINKS_PREFIX));
  if (at < 0) return { description: lines.join('\n').trim(), links: '' };
  return {
    description: [...lines.slice(0, at), ...lines.slice(at + 1)].join('\n').trim(),
    links: lines[at],
  };
}

/** `body` with its managed section replaced (or appended): text outside the markers stays as it is. */
export function withManagedPart(body: string, description: string, links: string): string {
  const section = `${BEGIN}\n${[description.trim(), links].filter(Boolean).join('\n\n')}\n${END}`;
  const a = body.indexOf(BEGIN);
  const b = body.indexOf(END);
  if (a >= 0 && b > a) return body.slice(0, a) + section + body.slice(b + END.length);
  return body.trim() ? `${body.trimEnd()}\n\n${section}` : section;
}

// ---- GraphQL and Projects (#42) ----

const graphqlUrl = (apiBase: string) => (/^https:\/\/api\.github\.com$/i.test(apiBase) ? 'https://api.github.com/graphql' : apiBase.replace(/\/v3$/, '/graphql'));

async function gql<T>(conn: ProviderConnection, query: string, variables: Record<string, unknown>, what: string): Promise<T> {
  const res = await conn.call({ method: 'POST', path: graphqlUrl(conn.apiBase), body: { query, variables } });
  const j = res.json as { data?: T; errors?: Array<{ message?: string; type?: string }> } | null;
  const err = j?.errors?.[0];
  if (res.status === 401) throw new TrackerError(`${LABEL} refused the token. Check the connection.`, 'auth', 401);
  if (res.status === 403 || err?.type === 'FORBIDDEN' || err?.type === 'INSUFFICIENT_SCOPES') throw new TrackerError(`${LABEL} doesn’t allow this token to ${what} (give it Projects access).`, 'refused', 403);
  if (err?.type === 'NOT_FOUND') throw new TrackerError(`${LABEL} couldn’t find it (${what}).`, 'not_found', 404);
  if (!ok(res) || err || !j?.data) throw new TrackerError(`${LABEL} refused to ${what}${err?.message ? `: ${err.message.slice(0, 300)}` : ` (${res.status})`}.`, 'invalid', res.status);
  return j.data;
}

interface ProjectField {
  id: string;
  name: string;
  dataType: string;
  options?: Array<{ id: string; name: string }>;
  configuration?: { iterations?: Iteration[]; completedIterations?: Iteration[] };
}
interface Iteration {
  id: string;
  title: string;
  startDate: string;
  duration: number;
}
interface Project {
  id: string;
  fields: ProjectField[];
}

const FIELDS_QUERY = `fields(first: 50) { nodes { __typename
  ... on ProjectV2FieldCommon { id name dataType }
  ... on ProjectV2SingleSelectField { options { id name } }
  ... on ProjectV2IterationField { configuration { iterations { id title startDate duration } completedIterations { id title startDate duration } } } } }`;

const TTL_MS = 60_000;
const projectCache = new Map<string, { at: number; project: Project | null }>();

/** The connection's planning Project ("owner/number" in its field map), its fields; null: none set or not found. */
async function planningProject(conn: ProviderConnection): Promise<Project | null> {
  const ref = conn.settings.planningProject;
  const m = ref ? /^([\w.-]{1,100})\/(\d{1,9})$/.exec(ref) : null;
  if (!m) return null;
  const key = `${conn.id}\n${ref}`;
  const hit = projectCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.project;
  // An owner is an organization or a user: ask for both, keep the one that exists.
  const res = await conn.call({
    method: 'POST',
    path: graphqlUrl(conn.apiBase),
    body: {
      query: `query ($login: String!, $number: Int!) { organization(login: $login) { projectV2(number: $number) { id ${FIELDS_QUERY} } } user(login: $login) { projectV2(number: $number) { id ${FIELDS_QUERY} } } }`,
      variables: { login: m[1], number: Number(m[2]) },
    },
  });
  if (res.status === 401) throw new TrackerError(`${LABEL} refused the token. Check the connection.`, 'auth', 401);
  const d = (res.json as { data?: Record<string, { projectV2?: { id: string; fields?: { nodes?: ProjectField[] } } | null } | null> } | null)?.data;
  const p = d?.organization?.projectV2 ?? d?.user?.projectV2 ?? null;
  const project = p ? { id: p.id, fields: (p.fields?.nodes ?? []).filter((f) => f?.id) } : null;
  projectCache.set(key, { at: Date.now(), project });
  return project;
}

async function projectById(conn: ProviderConnection, id: string): Promise<Project | null> {
  const key = `${conn.id}\n#${id}`;
  const hit = projectCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.project;
  const d = await gql<{ node?: { id: string; fields?: { nodes?: ProjectField[] } } | null }>(conn, `query ($id: ID!) { node(id: $id) { ... on ProjectV2 { id ${FIELDS_QUERY} } } }`, { id }, 'read a Project');
  const project = d.node?.id ? { id: d.node.id, fields: (d.node.fields?.nodes ?? []).filter((f) => f?.id) } : null;
  projectCache.set(key, { at: Date.now(), project });
  return project;
}

const named = (fields: ProjectField[], type: string, names: RegExp, picked?: string | null) =>
  (picked ? fields.find((f) => f.id === picked || labelKey(f.name) === labelKey(picked)) : undefined) ?? fields.find((f) => f.dataType === type && names.test(f.name.trim()));

/** The Project fields Freero syncs, by kind. */
function roles(conn: ProviderConnection, p: Project) {
  const f = p.fields;
  return {
    status: f.find((x) => x.dataType === 'SINGLE_SELECT' && /^status$/i.test(x.name.trim())),
    estimate: named(f, 'NUMBER', /^(estimate|points|story points|size|effort)$/i, conn.settings.estimateField),
    start: named(f, 'DATE', /^(start|start date|begins?)$/i, conn.settings.startDateField),
    target: named(f, 'DATE', /^(target|target date|end|end date|due|due date|deadline)$/i),
    iteration: f.find((x) => x.dataType === 'ITERATION'),
  };
}

interface ItemValue {
  __typename?: string;
  name?: string;
  optionId?: string;
  number?: number;
  date?: string;
  text?: string;
  title?: string;
  iterationId?: string;
  field?: { id?: string };
}
/** A page of a Project's items (polling, an iteration's import). */
type ItemsPage = {
  node?: { items?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string }; nodes?: Array<{ updatedAt?: string; content?: { number?: number; repository?: { nameWithOwner?: string } } | null; fieldValues?: { nodes?: ItemValue[] } }> } };
};
interface ProjectItem {
  id: string;
  project: { id: string };
  values: ItemValue[];
}

/** The issue's GraphQL id and its Project items (an issue's Projects need the token's Projects access). */
async function itemsOf(conn: ProviderConnection, repo: string, number: number): Promise<{ nodeId: string | null; items: ProjectItem[] }> {
  const [owner, name] = repo.split('/');
  try {
    const d = await gql<{ repository?: { issue?: { id: string; projectItems?: { nodes?: Array<{ id: string; project: { id: string }; fieldValues?: { nodes?: ItemValue[] } }> } } | null } | null }>(
      conn,
      `query ($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { id projectItems(first: 20) { nodes { id project { id } fieldValues(first: 50) { nodes { __typename
        ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2FieldCommon { id } } }
        ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { id } } }
        ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { id } } }
        ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { id } } }
        ... on ProjectV2ItemFieldIterationValue { title iterationId field { ... on ProjectV2FieldCommon { id } } } } } } } } } }`,
      { owner, name, number },
      'read the issue’s Projects',
    );
    const issue = d.repository?.issue;
    return { nodeId: issue?.id ?? null, items: (issue?.projectItems?.nodes ?? []).map((n) => ({ id: n.id, project: n.project, values: n.fieldValues?.nodes ?? [] })) };
  } catch (e) {
    // A token without Projects access still syncs the issue itself.
    if (e instanceof TrackerError && (e.kind === 'refused' || e.kind === 'not_found')) return { nodeId: null, items: [] };
    throw e;
  }
}

/** The item a sync uses: the one in the planning Project, else the issue's first. */
async function planItem(conn: ProviderConnection, items: ProjectItem[]): Promise<{ item: ProjectItem; project: Project } | null> {
  const planning = await planningProject(conn);
  const item = planning ? items.find((i) => i.project.id === planning.id) : items[0];
  if (!item) return null;
  const project = planning && item.project.id === planning.id ? planning : await projectById(conn, item.project.id);
  return project ? { item, project } : null;
}

const valueOf = (item: ProjectItem, field: ProjectField | undefined) => (field ? item.values.find((v) => v.field?.id === field.id) : undefined);

const DONE = /\b(done|complete(d)?|closed|shipped|released|resolved)\b/i;
const DOING = /\b(doing|in progress|progress|review|reviewing|active|working|started|wip|testing|qa|blocked)\b/i;
const categoryOf = (name: string | null): IssueStatusCategory => (name && DONE.test(name) ? 'done' : name && DOING.test(name) ? 'doing' : 'todo');

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function iterationsOf(field: ProjectField | undefined): TrackerSprint[] {
  if (!field) return [];
  const now = today();
  const open = (field.configuration?.iterations ?? []).map((i): TrackerSprint => {
    const end = addDays(i.startDate, i.duration - 1);
    return { id: i.id, name: i.title, state: i.startDate <= now && now <= end ? 'active' : 'future', startDate: i.startDate, endDate: end };
  });
  const done = (field.configuration?.completedIterations ?? []).map((i): TrackerSprint => ({ id: i.id, name: i.title, state: 'closed', startDate: i.startDate, endDate: addDays(i.startDate, i.duration - 1) }));
  return [...done, ...open].sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
}

function customOf(type: MappedFieldType, v: ItemValue | undefined): CustomValue {
  if (!v) return type === 'multiselect' ? [] : null;
  switch (type) {
    case 'select':
      return v.name ?? null;
    case 'number':
      return typeof v.number === 'number' ? v.number : null;
    case 'date':
      return v.date?.slice(0, 10) ?? null;
    case 'text':
      return v.text ?? null;
    default:
      return null;
  }
}

// ---- people ----

const profiles = new Map<string, { at: number; email: string | null }>();

/** A login as the board reads it: a Freero person (their own GitHub connection), else the profile's public email, else "~login". */
async function personOf(conn: ProviderConnection, login: string): Promise<string> {
  const mine = await conn.people?.emailOf(login).catch(() => null);
  if (mine) return mine;
  const hit = profiles.get(`${conn.apiBase}\n${login.toLowerCase()}`);
  let email = hit && Date.now() - hit.at < 10 * TTL_MS ? hit.email : undefined;
  if (email === undefined) {
    const res = await conn.call({ method: 'GET', path: `/users/${encodeURIComponent(login)}` });
    email = ok(res) ? ((res.json as GhUser).email?.toLowerCase() ?? null) : null;
    profiles.set(`${conn.apiBase}\n${login.toLowerCase()}`, { at: Date.now(), email });
  }
  return email ?? `~${login}`;
}

/** The login of a Freero person: their own GitHub connection's, else the one profile showing that address publicly. */
async function loginOf(conn: ProviderConnection, email: string): Promise<string | null> {
  const mine = await conn.people?.loginOf(email).catch(() => null);
  if (mine) return mine;
  const res = await conn.call({ method: 'GET', path: `/search/users?q=${encodeURIComponent(`${email} in:email`)}&per_page=2` });
  const items = ok(res) ? ((res.json as { items?: GhUser[] }).items ?? []) : [];
  return items.length === 1 ? items[0].login : null;
}

// ---- reading ----

const labelsOf = (i: GhIssue) => (i.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean);

async function toRemote(conn: ProviderConnection, repo: string, i: GhIssue, items: ProjectItem[] | null): Promise<RemoteIssue> {
  const closed = i.state === 'closed';
  const values: RemoteIssue['values'] = {
    title: i.title ?? '',
    description: managedPart(i.body ?? '').description,
    status: closed ? 'done' : 'todo',
    statusName: closed ? 'Closed' : 'Open',
    labels: labelsOf(i),
    dueDate: i.milestone?.due_on?.slice(0, 10) ?? null,
  };
  const first = i.assignees?.[0]?.login;
  values.assignee = first ? await personOf(conn, first) : null;
  const plan = items ? await planItem(conn, items) : null;
  if (plan) {
    const r = roles(conn, plan.project);
    if (r.status) {
      const name = valueOf(plan.item, r.status)?.name ?? null;
      values.statusName = name;
      values.status = closed ? 'done' : name ? categoryOf(name) : 'todo';
    }
    if (r.estimate) values.estimate = valueOf(plan.item, r.estimate)?.number ?? null;
    if (r.start) values.startDate = valueOf(plan.item, r.start)?.date?.slice(0, 10) ?? null;
    if (r.target) values.dueDate = valueOf(plan.item, r.target)?.date?.slice(0, 10) ?? null;
    if (r.iteration) values.sprint = valueOf(plan.item, r.iteration)?.title ?? null;
    const map = conn.settings.fieldMap ?? [];
    if (map.length) values.custom = Object.fromEntries(map.map((m) => [m.tracker, customOf(m.type, plan.item.values.find((v) => v.field?.id === m.tracker))]));
  }
  return {
    id: `${repo}#${i.number}`,
    key: `${repo}#${i.number}`,
    url: i.html_url,
    values,
    assigneeName: first ?? null,
    updatedAt: i.updated_at ? Date.parse(i.updated_at) || 0 : 0,
    groups: { team: repo, epic: i.milestone?.title ?? null },
    project: repo,
  };
}

async function rawIssue(conn: ProviderConnection, id: string): Promise<{ repo: string; issue: GhIssue } | null> {
  const { repo, number } = parseId(id);
  const res = await conn.call({ method: 'GET', path: `/repos/${repo}/issues/${number}` });
  if (res.status === 404 || res.status === 410) return null;
  if (!ok(res)) throw refused(res, 'read the issue');
  return { repo, issue: res.json as GhIssue };
}

async function readIssue(conn: ProviderConnection, id: string): Promise<{ repo: string; issue: GhIssue; items: ProjectItem[]; nodeId: string | null } | null> {
  const raw = await rawIssue(conn, id);
  if (!raw) return null;
  const { nodeId, items } = await itemsOf(conn, raw.repo, raw.issue.number);
  return { ...raw, items, nodeId: nodeId ?? raw.issue.node_id ?? null };
}

// ---- writing ----

async function setField(conn: ProviderConnection, projectId: string, itemId: string, fieldId: string, value: Record<string, unknown> | null, what: string) {
  if (value === null)
    await gql(conn, 'mutation ($p: ID!, $i: ID!, $f: ID!) { clearProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f }) { projectV2Item { id } } }', { p: projectId, i: itemId, f: fieldId }, what);
  else await gql(conn, 'mutation ($p: ID!, $i: ID!, $f: ID!, $v: ProjectV2FieldValue!) { updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: $v }) { projectV2Item { id } } }', { p: projectId, i: itemId, f: fieldId, v: value }, what);
}

const optionNamed = (f: ProjectField, name: string) => f.options?.find((o) => labelKey(o.name) === labelKey(name));

/** Writes `values` (only those present) onto the issue; returns notes for what couldn't be written. */
async function write(conn: ProviderConnection, cur: NonNullable<Awaited<ReturnType<typeof readIssue>>>, values: IssueValues): Promise<string[]> {
  const notes: string[] = [];
  const { repo, issue } = cur;
  const path = `/repos/${repo}/issues/${issue.number}`;
  const key = `${repo}#${issue.number}`;
  const patch: Record<string, unknown> = {};
  if (values.title !== undefined) patch.title = values.title.trim() || 'Untitled';
  if (values.description !== undefined) patch.body = withManagedPart(issue.body ?? '', values.description, managedPart(issue.body ?? '').links);
  // 'doing' has no GitHub state of its own: an open issue stays open.
  if (values.status === 'done' && issue.state !== 'closed') patch.state = 'closed';
  else if ((values.status === 'todo' || values.status === 'doing') && issue.state === 'closed') patch.state = 'open';

  // The Project item a write needs (added to the planning Project when the issue isn't in one).
  let plan = await planItem(conn, cur.items);
  const wantsProject = values.estimate !== undefined || values.startDate !== undefined || values.sprint !== undefined || (values.statusName !== undefined && values.statusName !== null && !/^(open|closed)$/i.test(values.statusName)) || Object.keys(values.custom ?? {}).length > 0;
  if (!plan && wantsProject) {
    const planning = await planningProject(conn);
    if (planning && cur.nodeId) {
      const d = await gql<{ addProjectV2ItemById?: { item?: { id: string } } }>(conn, 'mutation ($p: ID!, $c: ID!) { addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } } }', { p: planning.id, c: cur.nodeId }, `add ${key} to the Project`);
      if (d.addProjectV2ItemById?.item?.id) plan = { item: { id: d.addProjectV2ItemById.item.id, project: { id: planning.id }, values: [] }, project: planning };
    }
  }
  const r = plan ? roles(conn, plan.project) : null;

  // Due date: the Project's target date field, else the milestone due that day.
  if (values.dueDate !== undefined && !r?.target) {
    if (values.dueDate === null) {
      if (issue.milestone) patch.milestone = null;
    } else if (issue.milestone?.due_on?.slice(0, 10) !== values.dueDate) {
      const res = await conn.call({ method: 'GET', path: `/repos/${repo}/milestones?state=open&per_page=100` });
      if (!ok(res)) throw refused(res, `list the milestones of ${repo}`);
      const hit = ((res.json as Array<{ number: number; due_on?: string | null }>) ?? []).find((m) => m.due_on?.slice(0, 10) === values.dueDate);
      if (hit) patch.milestone = hit.number;
      else notes.push(`${repo} has no open milestone due on ${values.dueDate}, so ${key} kept its milestone (GitHub’s due dates are milestones’).`);
    }
  }
  if (Object.keys(patch).length) {
    const res = await conn.call({ method: 'PATCH', path, body: patch });
    if (!ok(res)) throw refused(res, `change ${key}`);
  }

  if (values.labels !== undefined) {
    const have = new Map(labelsOf(issue).map((l) => [labelKey(l), l]));
    const want = new Map(values.labels.map((l) => [labelKey(github.label(l)), github.label(l)]));
    const add = [...want].filter(([k]) => !have.has(k)).map(([, l]) => l);
    if (add.length) {
      const res = await conn.call({ method: 'POST', path: `${path}/labels`, body: { labels: add } });
      if (!ok(res)) throw refused(res, `label ${key}`);
    }
    for (const [k, l] of have)
      if (!want.has(k)) {
        const res = await conn.call({ method: 'DELETE', path: `${path}/labels/${encodeURIComponent(l)}` });
        if (!ok(res) && res.status !== 404) throw refused(res, `remove a label from ${key}`);
      }
  }

  if (values.assignee !== undefined) {
    // The card has one assignee: the issue's first; the others GitHub lists stay.
    const first = issue.assignees?.[0]?.login ?? null;
    let login: string | null = null;
    if (values.assignee && !values.assignee.startsWith('~')) {
      login = await loginOf(conn, values.assignee);
      if (!login) notes.push(`No GitHub account is known for ${values.assignee} (they can connect their own GitHub in Freero’s Settings, or show the address on their GitHub profile), so the assignee wasn’t sent.`);
    }
    if (values.assignee === null || login) {
      if (login && !(issue.assignees ?? []).some((a) => a.login.toLowerCase() === login!.toLowerCase())) {
        const res = await conn.call({ method: 'POST', path: `${path}/assignees`, body: { assignees: [login] } });
        if (!ok(res)) throw refused(res, `assign ${key}`);
      }
      if (first && first.toLowerCase() !== (login ?? '').toLowerCase()) {
        const res = await conn.call({ method: 'DELETE', path: `${path}/assignees`, body: { assignees: [first] } });
        if (!ok(res)) throw refused(res, `unassign ${key}`);
      }
    }
  }

  if (wantsProject && !plan) {
    notes.push(`${key} isn’t in a GitHub Project (set the connection’s planning Project in its field map), so its Project fields weren’t sent.`);
    return notes;
  }
  if (plan && r) {
    const pid = plan.project.id;
    const iid = plan.item.id;
    if (values.statusName !== undefined || values.status !== undefined) {
      if (r.status) {
        const current = valueOf(plan.item, r.status)?.name ?? null;
        const want = values.status ?? null;
        const named = values.statusName ? optionNamed(r.status, values.statusName) : undefined;
        const byKind = !named && want && want !== categoryOf(current) ? r.status.options?.find((o) => categoryOf(o.name) === want) : undefined;
        const target = named ?? byKind;
        if (target && labelKey(target.name) !== labelKey(current ?? '')) await setField(conn, pid, iid, r.status.id, { singleSelectOptionId: target.id }, `move ${key} to ${target.name}`);
        else if (!target && values.statusName && !/^(open|closed)$/i.test(values.statusName) && labelKey(values.statusName) !== labelKey(current ?? ''))
          notes.push(`The Project’s Status has no option “${values.statusName}”, so ${key} stayed in ${current ?? 'no status'}.`);
      }
    }
    const one = async (v: unknown, f: ProjectField | undefined, value: Record<string, unknown> | null, what: string, name: string) => {
      if (v === undefined) return;
      if (!f) return void notes.push(`The Project has no ${name} field, so it wasn’t sent.`);
      await setField(conn, pid, iid, f.id, value, what);
    };
    await one(values.estimate, r.estimate, values.estimate === null || values.estimate === undefined ? null : { number: values.estimate }, `set the estimate of ${key}`, 'estimate');
    await one(values.startDate, r.start, values.startDate ? { date: values.startDate } : null, `set the start date of ${key}`, 'Start date');
    if (r.target) await one(values.dueDate, r.target, values.dueDate ? { date: values.dueDate } : null, `set the target date of ${key}`, 'Target date');
    if (values.sprint !== undefined) {
      if (!r.iteration) notes.push('The Project has no Iteration field, so the iteration wasn’t sent.');
      else if (values.sprint === null) await setField(conn, pid, iid, r.iteration.id, null, `take ${key} out of its iteration`);
      else {
        const it = iterationsOf(r.iteration).find((s) => labelKey(s.name) === labelKey(values.sprint!));
        if (!it) notes.push(`The Project has no iteration “${values.sprint}”, so it wasn’t sent.`);
        else if (it.state === 'closed') notes.push(`${values.sprint} is a completed iteration in ${LABEL}, so ${key} stayed where it was.`);
        else await setField(conn, pid, iid, r.iteration.id, { iterationId: it.id }, `move ${key} to ${it.name}`);
      }
    }
    for (const [id, v] of Object.entries(values.custom ?? {})) {
      const e = (conn.settings.fieldMap ?? []).find((m) => m.tracker === id);
      const f = plan.project.fields.find((x) => x.id === id);
      if (!e || v === undefined) continue;
      if (!f) {
        notes.push(`${e.trackerName || id} isn’t a field of the Project, so it wasn’t sent.`);
        continue;
      }
      if (v === null || v === '') await setField(conn, pid, iid, id, null, `clear ${e.trackerName}`);
      else if (e.type === 'select') {
        const o = optionNamed(f, String(v));
        if (!o) notes.push(`${e.trackerName || id} has no option “${v}” in the Project, so it wasn’t sent.`);
        else await setField(conn, pid, iid, id, { singleSelectOptionId: o.id }, `set ${e.trackerName}`);
      } else if (e.type === 'number') await setField(conn, pid, iid, id, { number: Number(v) }, `set ${e.trackerName}`);
      else if (e.type === 'date') await setField(conn, pid, iid, id, { date: String(v).slice(0, 10) }, `set ${e.trackerName}`);
      else await setField(conn, pid, iid, id, { text: String(v) }, `set ${e.trackerName}`);
    }
  }
  return notes;
}

const hmacOk = (secret: string, body: Buffer, given: string | undefined): boolean => {
  const m = given ? /^sha256=([0-9a-f]{64})$/i.exec(given.trim()) : null;
  if (!m) return false;
  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(m[1], 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
};

export const github: TrackerProvider = {
  kind: 'github',
  fields: ['title', 'description', 'status', 'statusName', 'assignee', 'labels', 'startDate', 'dueDate', 'estimate', 'sprint'],
  queryLanguage: 'GitHub search',
  parents: { issueType: null },

  authHeaders(creds: Credentials) {
    const token = creds.kind === 'oauth' ? creds.accessToken : creds.token;
    return {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    };
  },

  endpoints: (apiBase) => [graphqlUrl(apiBase)],

  async whoAmI(conn) {
    const res = await conn.call({ method: 'GET', path: '/user' });
    if (!ok(res)) throw refused(res, 'say who the token is');
    const login = String((res.json as { login?: string })?.login ?? 'GitHub user');
    return { account: login, settings: { login } };
  },

  async listProjects(conn) {
    const res = await conn.call({ method: 'GET', path: '/user/repos?per_page=100&sort=updated' });
    if (!ok(res)) throw refused(res, 'list repositories');
    return ((res.json as Array<{ id?: number; full_name?: string }>) ?? []).filter((r) => r.full_name).map((r) => ({ id: String(r.id ?? r.full_name), key: r.full_name!, name: r.full_name! }));
  },

  async listFields(conn) {
    // The planning Project's fields (#42): the estimate / start date pickers and the field map.
    const p = await planningProject(conn);
    if (!p) return [];
    const kinds: Record<string, MappedFieldType> = { SINGLE_SELECT: 'select', NUMBER: 'number', DATE: 'date', TEXT: 'text' };
    return p.fields
      .filter((f) => !['TITLE', 'ASSIGNEES', 'LABELS', 'MILESTONE', 'REPOSITORY', 'LINKED_PULL_REQUESTS', 'REVIEWERS', 'TRACKS', 'TRACKED_BY', 'PARENT_ISSUE', 'SUB_ISSUES_PROGRESS'].includes(f.dataType))
      .map((f): TrackerFieldInfo => ({ id: f.id, name: f.name, type: kinds[f.dataType] ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  sprints: {
    fieldName: 'Iteration',
    async list(conn) {
      const p = await planningProject(conn);
      return p ? iterationsOf(roles(conn, p).iteration) : [];
    },
  },

  async getIssue(conn, id) {
    const cur = await readIssue(conn, id);
    return cur ? toRemote(conn, cur.repo, cur.issue, cur.items) : null;
  },

  async createIssue(conn, input: CreateIssueInput) {
    if (!REPO.test(input.project)) throw new TrackerError(`Name the repository as owner/name.`, 'invalid', 400);
    const parent = input.parent ? githubIssueRef(input.parent, input.project) : null;
    if (input.parent && !parent) throw new TrackerError(`${input.parent} isn’t a ${LABEL} issue (#12, owner/name#12 or its address).`, 'invalid', 400);
    const v = input.values;
    const body: Record<string, unknown> = { title: (v.title ?? '').trim() || 'Untitled' };
    if (v.description !== undefined) body.body = withManagedPart('', v.description, '');
    if (v.labels?.length) body.labels = [...new Set(v.labels.map(github.label).filter(Boolean))];
    const res = await conn.call({ method: 'POST', path: `/repos/${input.project}/issues`, body });
    if (!ok(res)) throw refused(res, `create an issue in ${input.project}`);
    const made = res.json as GhIssue;
    const id = `${input.project}#${made.number}`;
    const notes: string[] = [];
    if (parent) {
      // A sub-issue (#42): the parent names the child by its REST id.
      const sub = await conn.call({ method: 'POST', path: `/repos/${parent.repo}/issues/${parent.number}/sub_issues`, body: { sub_issue_id: made.id } });
      if (!ok(sub)) notes.push(`${LABEL} didn’t put ${id} under ${parent.repo}#${parent.number}${trackerMessage(sub.json) ? ` (${trackerMessage(sub.json)})` : ''}.`);
    }
    // New issues join the planning Project, so their Status and fields can be set.
    const planning = await planningProject(conn);
    if (planning && made.node_id)
      await gql(conn, 'mutation ($p: ID!, $c: ID!) { addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } } }', { p: planning.id, c: made.node_id }, `add ${id} to the Project`);
    const { title: _t, description: _d, labels: _l, ...rest } = v;
    const fresh = await readIssue(conn, id);
    if (fresh && Object.keys(rest).length) notes.push(...(await write(conn, fresh, { ...rest, ...(rest.assignee === null ? { assignee: undefined } : {}) })));
    const after = await readIssue(conn, id);
    return { issue: after ? await toRemote(conn, after.repo, after.issue, after.items) : await toRemote(conn, input.project, made, []), notes };
  },

  async updateIssue(conn, issue, patch) {
    const cur = await readIssue(conn, issue.id);
    if (!cur) throw new TrackerError(`${issue.key} no longer exists in ${LABEL}.`, 'not_found', 404);
    return write(conn, cur, patch);
  },

  async search(conn, query, limit) {
    const q = /\bis:(issue|pr)\b/.test(query) ? query : `${query} is:issue`;
    const res = await conn.call({ method: 'GET', path: `/search/issues?q=${encodeURIComponent(q)}&per_page=${Math.min(100, limit)}` });
    if (res.status === 422) throw new TrackerError(`${LABEL} couldn’t run that search${trackerMessage(res.json) ? `: ${trackerMessage(res.json)}` : '.'}`, 'invalid', 422);
    if (!ok(res)) throw refused(res, 'search issues');
    const items = ((res.json as { items?: GhIssue[] })?.items ?? []).filter((i) => !i.pull_request).slice(0, limit);
    const out: RemoteIssue[] = [];
    for (const i of items) {
      const m = /\/repos\/([\w.-]+\/[\w.-]+)$/.exec(i.repository_url ?? '');
      if (m) out.push(await toRemote(conn, m[1], i, (await itemsOf(conn, m[1], i.number)).items));
    }
    return out;
  },

  async scoped(conn, scope, limit) {
    if (scope.sprint) {
      // An iteration of the planning Project (#42): its items in that iteration, of this repository.
      const p = await planningProject(conn);
      const field = p ? roles(conn, p).iteration : undefined;
      if (!p || !field) throw new TrackerError(`Set a planning Project with an Iteration field in the connection’s field map to import an iteration.`, 'invalid', 400);
      const keys: string[] = [];
      let after: string | null = null;
      for (let page = 0; page < 10 && keys.length < limit; page++) {
        const d: ItemsPage = await gql<ItemsPage>(
          conn,
          'query ($id: ID!, $after: String) { node(id: $id) { ... on ProjectV2 { items(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { content { ... on Issue { number repository { nameWithOwner } } } fieldValues(first: 50) { nodes { ... on ProjectV2ItemFieldIterationValue { iterationId field { ... on ProjectV2FieldCommon { id } } } } } } } } } }',
          { id: p.id, after },
          'list the iteration’s issues',
        );
        for (const n of d.node?.items?.nodes ?? []) {
          const repo = n.content?.repository?.nameWithOwner;
          if (!repo || !n.content?.number || (scope.project && repo.toLowerCase() !== scope.project.toLowerCase())) continue;
          if ((n.fieldValues?.nodes ?? []).some((v) => v.field?.id === field.id && v.iterationId === scope.sprint)) keys.push(`${repo}#${n.content.number}`);
        }
        if (!d.node?.items?.pageInfo?.hasNextPage) break;
        after = d.node.items.pageInfo.endCursor ?? null;
      }
      const out: RemoteIssue[] = [];
      for (const k of keys.slice(0, limit)) {
        const cur = await readIssue(conn, k);
        if (cur) out.push(await toRemote(conn, cur.repo, cur.issue, cur.items));
      }
      return out;
    }
    // A parent issue's sub-issues (#42).
    if (!scope.epic) throw new TrackerError(`${LABEL} issues are imported with a search, an iteration, or a parent issue’s sub-issues.`, 'invalid', 400);
    const parent = githubIssueRef(scope.epic, scope.project);
    if (!parent) throw new TrackerError(`${scope.epic} isn’t a ${LABEL} issue.`, 'invalid', 400);
    const res = await conn.call({ method: 'GET', path: `/repos/${parent.repo}/issues/${parent.number}/sub_issues?per_page=${Math.min(100, limit)}` });
    if (!ok(res)) throw refused(res, `list the sub-issues of ${parent.repo}#${parent.number}`);
    const out: RemoteIssue[] = [];
    for (const i of ((res.json as GhIssue[]) ?? []).slice(0, limit)) {
      const repo = /\/repos\/([\w.-]+\/[\w.-]+)$/.exec(i.repository_url ?? '')?.[1] ?? parent.repo;
      out.push(await toRemote(conn, repo, i, (await itemsOf(conn, repo, i.number)).items));
    }
    return out;
  },

  async changedSince(conn, issues, since) {
    const byRepo = new Map<string, Set<string>>();
    for (const i of issues) {
      const { repo } = parseId(i.id);
      byRepo.set(repo, (byRepo.get(repo) ?? new Set()).add(i.id));
    }
    const out = new Set<string>();
    for (const [repo, ids] of byRepo) {
      const res = await conn.call({ method: 'GET', path: `/repos/${repo}/issues?state=all&per_page=100&since=${encodeURIComponent(new Date(since).toISOString())}` });
      if (!ok(res)) throw refused(res, 'list changed issues');
      for (const i of (res.json as GhIssue[]) ?? []) if (ids.has(`${repo}#${i.number}`)) out.add(`${repo}#${i.number}`);
    }
    // A Project field changed doesn't touch the issue: the planning Project's items say when they changed.
    const planning = await planningProject(conn).catch(() => null);
    if (planning) {
      const all = new Set(issues.map((i) => i.id));
      let after: string | null = null;
      for (let page = 0; page < 10; page++) {
        const d: ItemsPage = await gql<ItemsPage>(
          conn,
          'query ($id: ID!, $after: String) { node(id: $id) { ... on ProjectV2 { items(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { updatedAt content { ... on Issue { number repository { nameWithOwner } } } } } } } }',
          { id: planning.id, after },
          'check what changed in the Project',
        );
        for (const n of d.node?.items?.nodes ?? []) {
          const key = n.content?.repository?.nameWithOwner && n.content.number ? `${n.content.repository.nameWithOwner}#${n.content.number}` : null;
          if (key && all.has(key) && (Date.parse(n.updatedAt ?? '') || 0) >= since) out.add(key);
        }
        if (!d.node?.items?.pageInfo?.hasNextPage) break;
        after = d.node.items.pageInfo.endCursor ?? null;
      }
    }
    return [...out];
  },

  async setBacklinks(conn, issue, links: Backlink[]) {
    // Every item's link lives in the managed section: rewrite that line as a whole.
    const raw = await rawIssue(conn, issue.id);
    if (!raw) throw new TrackerError(`${LABEL} couldn’t find ${issue.key}.`, 'not_found', 404);
    const body = raw.issue.body ?? '';
    const cur = managedPart(body);
    const line = links.length ? `${LINKS_PREFIX}${links.map((l, i) => `[${links.length === 1 ? 'open' : `item ${i + 1}`}](${l.url})`).join(' · ')}` : '';
    if (line === cur.links && body.includes(BEGIN)) return;
    const { repo, number } = parseId(issue.id);
    const res = await conn.call({ method: 'PATCH', path: `/repos/${repo}/issues/${number}`, body: { body: withManagedPart(body, cur.description, line) } });
    if (!ok(res)) throw refused(res, `link ${issue.key} back to the board`);
  },

  label: (tag) => tag.trim().slice(0, 50),

  webhook(d) {
    const sig = d.headers['x-hub-signature-256'];
    if (!hmacOk(d.secret, d.rawBody, Array.isArray(sig) ? sig[0] : sig)) return null;
    let body: {
      issue?: { number?: number };
      repository?: { full_name?: string };
    } | null = null;
    try {
      body = JSON.parse(d.rawBody.toString('utf8'));
    } catch {
      return { issues: [] };
    }
    const n = body?.issue?.number;
    const repo = body?.repository?.full_name;
    return {
      issues: typeof n === 'number' && typeof repo === 'string' ? [`${repo}#${n}`] : [],
    };
  },
};
