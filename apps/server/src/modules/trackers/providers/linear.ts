// Linear, through its public GraphQL API (https://api.linear.app/graphql) with a personal API key
// (sent as is) or an OAuth access token (Bearer). Teams are the "projects" issues are created in;
// workflow state types map to the board's statuses; labels are the team's (made when missing);
// backlinks are issue attachments (one per board item, found again by their URL). Webhooks carry
// `Linear-Signature` (HMAC-SHA256 of the body) and a `webhookTimestamp` that must be recent.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { TRACKER_PROVIDERS, type IssueStatusCategory, type IssueValues } from '@freero/shared';
import { trackerMessage, TrackerError, type HttpResponse } from '../http';
import type { Backlink, Credentials, ProviderConnection, RemoteIssue, TrackerProvider } from './types';

const LABEL = TRACKER_PROVIDERS.linear;
/** A webhook older than this is refused (replays). */
const WEBHOOK_MAX_AGE_MS = 60_000;

const ISSUE = `id identifier url title description updatedAt dueDate estimate
  state { name type } assignee { name email } labels { nodes { name } } team { id key }`;

const CATEGORY: Record<string, IssueStatusCategory> = {
  triage: 'todo',
  backlog: 'todo',
  unstarted: 'todo',
  started: 'doing',
  completed: 'done',
  canceled: 'done',
};
const STATE_TYPES: Record<IssueStatusCategory, string[]> = {
  todo: ['unstarted', 'backlog'],
  doing: ['started'],
  done: ['completed'],
};

interface LinearIssue {
  id: string;
  identifier: string;
  url: string;
  title?: string;
  description?: string | null;
  updatedAt?: string;
  dueDate?: string | null;
  estimate?: number | null;
  state?: { name?: string; type?: string } | null;
  assignee?: { name?: string; email?: string } | null;
  labels?: { nodes?: Array<{ name?: string }> };
  team?: { id: string; key: string };
}

async function gql<T>(conn: ProviderConnection, query: string, variables: Record<string, unknown> = {}, what = 'answer'): Promise<T> {
  const res: HttpResponse = await conn.call({
    method: 'POST',
    path: '/graphql',
    body: { query, variables },
  });
  const j = res.json as {
    data?: T;
    errors?: Array<{
      message?: string;
      extensions?: { code?: string; type?: string };
    }>;
  } | null;
  const err = j?.errors?.[0];
  if (res.status === 401 || err?.extensions?.code === 'AUTHENTICATION_ERROR') throw new TrackerError(`${LABEL} refused the credentials. Check the connection.`, 'auth', 401);
  if (err?.extensions?.code === 'RATELIMITED') throw new TrackerError(`${LABEL} is rate limiting Freero; the sync will try again shortly.`, 'rate', 429, 60_000);
  if (err && /not found|could not find/i.test(err.message ?? '')) throw new TrackerError(`${LABEL} couldn’t find it.`, 'not_found', 404);
  if (res.status === 403 || err?.extensions?.code === 'FORBIDDEN') throw new TrackerError(`${LABEL} doesn’t allow this connection to ${what}.`, 'refused', 403);
  if (err || res.status < 200 || res.status >= 300 || !j?.data)
    throw new TrackerError(
      `${LABEL} refused to ${what}${err?.message ? `: ${String(err.message).slice(0, 300)}` : trackerMessage(res.json) ? `: ${trackerMessage(res.json)}` : ` (${res.status})`}.`,
      'invalid',
      res.status,
    );
  return j.data;
}

function toRemote(i: LinearIssue): RemoteIssue {
  return {
    id: i.id,
    key: i.identifier,
    url: i.url,
    values: {
      title: i.title ?? '',
      description: i.description ?? '',
      status: i.state?.type ? (CATEGORY[i.state.type] ?? null) : null,
      statusName: i.state?.name ?? null,
      assignee: i.assignee ? (i.assignee.email?.toLowerCase() ?? `~${i.assignee.name ?? 'someone'}`) : null,
      labels: (i.labels?.nodes ?? []).map((l) => l.name ?? '').filter(Boolean),
      dueDate: i.dueDate ? i.dueDate.slice(0, 10) : null,
      estimate: typeof i.estimate === 'number' ? i.estimate : null,
    },
    assigneeName: i.assignee?.name ?? null,
    updatedAt: i.updatedAt ? Date.parse(i.updatedAt) || 0 : 0,
  };
}

async function teamId(conn: ProviderConnection, key: string): Promise<string> {
  const d = await gql<{ teams: { nodes: Array<{ id: string }> } }>(
    conn,
    `query($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id } } }`,
    { key },
    'find the team',
  );
  const id = d.teams.nodes[0]?.id;
  if (!id) throw new TrackerError(`${LABEL} has no team with the key ${key}.`, 'invalid', 400);
  return id;
}

async function labelIds(conn: ProviderConnection, team: string, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const d = await gql<{
    issueLabels: { nodes: Array<{ id: string; name: string }> };
  }>(conn, `query($names: [String!]) { issueLabels(filter: { name: { in: $names } }, first: 250) { nodes { id name } } }`, { names }, 'read labels');
  const byName = new Map(d.issueLabels.nodes.map((l) => [l.name.toLowerCase(), l.id]));
  const out: string[] = [];
  for (const n of names) {
    let id = byName.get(n.toLowerCase());
    if (!id) {
      const made = await gql<{
        issueLabelCreate: { issueLabel: { id: string } };
      }>(
        conn,
        `mutation($name: String!, $teamId: String) { issueLabelCreate(input: { name: $name, teamId: $teamId }) { issueLabel { id } } }`,
        { name: n, teamId: team },
        'create a label',
      );
      id = made.issueLabelCreate.issueLabel.id;
      byName.set(n.toLowerCase(), id);
    }
    out.push(id);
  }
  return out;
}

async function stateId(conn: ProviderConnection, team: string, want: IssueStatusCategory): Promise<string | null> {
  const d = await gql<{
    workflowStates: {
      nodes: Array<{ id: string; type: string; position: number }>;
    };
  }>(
    conn,
    `query($team: ID!, $types: [String!]) { workflowStates(filter: { team: { id: { eq: $team } }, type: { in: $types } }) { nodes { id type position } } }`,
    { team, types: STATE_TYPES[want] },
    'read the workflow',
  );
  const order = STATE_TYPES[want];
  const nodes = [...d.workflowStates.nodes].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.position - b.position);
  return nodes[0]?.id ?? null;
}

/** The `input` of issueCreate / issueUpdate for the values present. */
async function inputFor(conn: ProviderConnection, team: string, values: IssueValues, notes: string[]): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  if (values.title !== undefined) input.title = values.title.trim() || 'Untitled';
  if (values.description !== undefined) input.description = values.description;
  if (values.labels !== undefined) input.labelIds = await labelIds(conn, team, [...new Set(values.labels.map(linear.label).filter(Boolean))]);
  if (values.dueDate !== undefined) input.dueDate = values.dueDate;
  if (values.estimate !== undefined) input.estimate = values.estimate === null ? null : Math.round(values.estimate);
  if (values.status) {
    const id = await stateId(conn, team, values.status);
    if (id) input.stateId = id;
    else notes.push(`The ${LABEL} team has no ${values.status === 'doing' ? 'started' : values.status === 'done' ? 'completed' : 'unstarted'} state, so the status stayed.`);
  }
  if (values.assignee !== undefined) {
    if (values.assignee === null) input.assigneeId = null;
    else if (!values.assignee.startsWith('~')) {
      const d = await gql<{ users: { nodes: Array<{ id: string }> } }>(
        conn,
        `query($email: String!) { users(filter: { email: { eq: $email } }) { nodes { id } } }`,
        { email: values.assignee },
        'find the assignee',
      );
      if (d.users.nodes[0]) input.assigneeId = d.users.nodes[0].id;
      else notes.push(`No ${LABEL} member has the address ${values.assignee}, so the issue was left unassigned there.`);
    }
  }
  return input;
}

const hmacOk = (secret: string, body: Buffer, given: string | undefined): boolean => {
  if (!given || !/^[0-9a-f]{64}$/i.test(given.trim())) return false;
  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(given.trim(), 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
};

export const linear: TrackerProvider = {
  kind: 'linear',
  fields: ['title', 'description', 'status', 'assignee', 'labels', 'dueDate', 'estimate'],
  queryLanguage: 'Search',

  authHeaders(creds: Credentials) {
    // Personal API keys go as they are; OAuth access tokens as Bearer.
    return creds.kind === 'oauth' ? { authorization: `Bearer ${creds.accessToken}` } : { authorization: creds.token };
  },

  async whoAmI(conn) {
    const d = await gql<{ viewer: { name?: string; email?: string } }>(conn, `{ viewer { name email } }`, {}, 'say who the connection is');
    return { account: d.viewer.email ?? d.viewer.name ?? 'Linear user' };
  },

  async listProjects(conn) {
    const d = await gql<{
      teams: { nodes: Array<{ id: string; key: string; name: string }> };
    }>(conn, `{ teams(first: 100) { nodes { id key name } } }`, {}, 'list teams');
    return d.teams.nodes.map((t) => ({ id: t.id, key: t.key, name: t.name }));
  },

  async getIssue(conn, id) {
    try {
      const d = await gql<{ issue: LinearIssue | null }>(conn, `query($id: String!) { issue(id: $id) { ${ISSUE} } }`, { id }, 'read the issue');
      return d.issue ? toRemote(d.issue) : null;
    } catch (e) {
      if (e instanceof TrackerError && e.kind === 'not_found') return null;
      throw e;
    }
  },

  async createIssue(conn, input) {
    const notes: string[] = [];
    const team = await teamId(conn, input.project);
    const fields = await inputFor(
      conn,
      team,
      {
        ...input.values,
        ...(input.values.assignee === null ? { assignee: undefined } : {}),
      },
      notes,
    );
    const d = await gql<{ issueCreate: { issue: LinearIssue } }>(
      conn,
      `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { ${ISSUE} } } }`,
      { input: { teamId: team, ...fields } },
      `create an issue in ${input.project}`,
    );
    return { issue: toRemote(d.issueCreate.issue), notes };
  },

  async updateIssue(conn, issue, patch) {
    const notes: string[] = [];
    const current = await gql<{ issue: LinearIssue }>(conn, `query($id: String!) { issue(id: $id) { team { id } } }`, { id: issue.id }, 'read the issue');
    const input = await inputFor(conn, current.issue.team!.id, patch, notes);
    if (Object.keys(input).length)
      await gql(conn, `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, { id: issue.id, input }, `change ${issue.key}`);
    return notes;
  },

  async search(conn, query, limit) {
    const d = await gql<{ searchIssues: { nodes: LinearIssue[] } }>(
      conn,
      `query($term: String!, $first: Int) { searchIssues(term: $term, first: $first) { nodes { ${ISSUE} } } }`,
      { term: query, first: Math.min(100, limit) },
      'search issues',
    );
    return d.searchIssues.nodes.map(toRemote);
  },

  async changedSince(conn, issues, since) {
    const out: string[] = [];
    for (let i = 0; i < issues.length; i += 100) {
      const ids = issues.slice(i, i + 100).map((x) => x.id);
      const d = await gql<{ issues: { nodes: Array<{ id: string }> } }>(
        conn,
        `query($ids: [ID!], $since: DateTimeOrDuration) { issues(filter: { id: { in: $ids }, updatedAt: { gte: $since } }, first: 100) { nodes { id } } }`,
        { ids, since: new Date(since).toISOString() },
        'list changed issues',
      );
      out.push(...d.issues.nodes.map((n) => n.id));
    }
    return out;
  },

  async setBacklinks(conn, issue, links: Backlink[], removed) {
    for (const l of links)
      await gql(
        conn,
        `mutation($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }`,
        {
          input: {
            issueId: issue.id,
            url: l.url,
            title: l.title,
            subtitle: 'On a Freero board',
          },
        },
        `link ${issue.key} back to the board`,
      );
    if (!removed.length) return;
    const d = await gql<{
      issue: { attachments: { nodes: Array<{ id: string; url: string }> } };
    }>(conn, `query($id: String!) { issue(id: $id) { attachments { nodes { id url } } } }`, { id: issue.id }, 'read the issue’s links');
    for (const a of d.issue.attachments.nodes) {
      let item: string | null = null;
      try {
        const u = new URL(a.url);
        item = u.searchParams.get('item') ?? u.searchParams.get('el');
      } catch {
        /* not ours */
      }
      if (item && removed.includes(item)) await gql(conn, `mutation($id: String!) { attachmentDelete(id: $id) { success } }`, { id: a.id }, `remove a link from ${issue.key}`);
    }
  },

  label: (tag) => tag.trim().slice(0, 80),

  webhook(d) {
    const sig = d.headers['linear-signature'];
    if (!hmacOk(d.secret, d.rawBody, Array.isArray(sig) ? sig[0] : sig)) return null;
    let body: {
      type?: string;
      webhookTimestamp?: number;
      data?: { id?: string; identifier?: string; issueId?: string };
    } | null = null;
    try {
      body = JSON.parse(d.rawBody.toString('utf8'));
    } catch {
      return null;
    }
    // Signed but old: a replay. Nothing in it is trusted anyway (the issue is read back), but
    // there is no reason to act on it.
    if (typeof body?.webhookTimestamp !== 'number' || Math.abs(d.now - body.webhookTimestamp) > WEBHOOK_MAX_AGE_MS) return null;
    const data = body.data ?? {};
    return {
      issues: (body.type === 'Issue' ? [data.id, data.identifier] : [data.issueId]).filter((x): x is string => typeof x === 'string'),
    };
  },
};
