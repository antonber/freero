// Jira Cloud and Jira Data Center / Server, through Jira's public REST API only.
//
//   Cloud        REST v3, descriptions in ADF; an API token with the account's email (Basic), or
//                OAuth 2.0 (3LO) through api.atlassian.com/ex/jira/<cloud id> (an app the
//                operator registers: TRACKER_JIRA_CLIENT_ID / _SECRET).
//   Data Center  REST v2, descriptions in wiki markup; a personal access token (Bearer).
//
// Differences handled here: description format, search (Cloud: POST /search/jql; DC: POST
// /search), user search (`query` vs `username`) and assignee ids (accountId vs name). Status
// changes go through the workflow's transitions — when none leads to the wanted category the
// sync says so instead of forcing anything. Story points live in a custom field found by name.
// Backlinks are remote links with a stable global id per board item. Webhooks are signed with
// the connection's secret (X-Hub-Signature: sha256=…), as Jira sends them for a webhook with a
// secret.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { TRACKER_PROVIDERS, type IssueStatusCategory, type IssueValues, type TrackerProject } from '@freero/shared';
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
  };
}

const issueFields = (conn: ProviderConnection) =>
  ['summary', 'description', 'status', 'assignee', 'labels', 'duedate', 'updated', ...(conn.settings.estimateField ? [conn.settings.estimateField] : [])].join(',');

function toRemote(conn: ProviderConnection, j: JiraIssue): RemoteIssue {
  const f = j.fields ?? {};
  const assignee = f.assignee ?? null;
  const cat = f.status?.statusCategory?.key ? (CATEGORY[f.status.statusCategory.key] ?? null) : null;
  const est = conn.settings.estimateField ? f[conn.settings.estimateField] : null;
  return {
    id: String(j.id),
    key: String(j.key),
    url: `${conn.site.replace(/\/+$/, '')}/browse/${encodeURIComponent(j.key)}`,
    values: {
      title: typeof f.summary === 'string' ? f.summary : '',
      description: cloud(conn) ? adfToMarkdown(f.description) : wikiToMarkdown(f.description),
      status: cat,
      statusName: f.status?.name ?? null,
      // An assignee whose email Jira hides (Cloud privacy settings) is told apart by id.
      assignee: assignee ? (assignee.emailAddress?.toLowerCase() ?? `~${assignee.accountId ?? assignee.name ?? assignee.key ?? 'someone'}`) : null,
      labels: Array.isArray(f.labels) ? f.labels.filter((l): l is string => typeof l === 'string') : [],
      dueDate: typeof f.duedate === 'string' ? f.duedate.slice(0, 10) : null,
      estimate: typeof est === 'number' ? est : null,
    },
    assigneeName: assignee?.displayName ?? null,
    updatedAt: f.updated ? Date.parse(f.updated) || 0 : 0,
  };
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
      notes.push(
        `${LABEL} didn’t accept ${bad.map((k) => FIELD_NAMES[k] ?? (k === conn.settings.estimateField ? 'the estimate' : k)).join(', ')} on this issue (not on its screen), so ${bad.length === 1 ? 'it was' : 'they were'} left out.`,
      );
      res = await send(rest);
    }
  }
  if (!ok(res)) throw refused(res, what);
  return res;
}

async function transition(conn: ProviderConnection, issue: RemoteIssue, want: IssueStatusCategory, notes: string[]): Promise<void> {
  if (issue.values.status === want) return;
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
  const hit = ts.find((t) => t.to?.statusCategory?.key && CATEGORY[t.to.statusCategory.key] === want);
  if (!hit) {
    notes.push(
      `The ${LABEL} workflow has no transition from “${issue.values.statusName ?? 'its status'}” to ${CATEGORY_LABEL[want].toLowerCase()} for ${issue.key}, so its status stayed.`,
    );
    return;
  }
  const done = await conn.call({
    method: 'POST',
    path: `/rest/api/${v(conn)}/issue/${encodeURIComponent(issue.id)}/transitions`,
    body: { transition: { id: hit.id } },
  });
  if (!ok(done)) throw refused(done, `move ${issue.key} to ${hit.to?.name ?? CATEGORY_LABEL[want]}`);
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
  fields: ['title', 'description', 'status', 'assignee', 'labels', 'dueDate', 'estimate'],
  queryLanguage: 'JQL',

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
    if (ok(fields) && Array.isArray(fields.json)) {
      const list = fields.json as Array<{ id?: string; name?: string }>;
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
      settings: { estimateField },
    };
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
    const { status, ...rest } = input.values;
    const fields = {
      project: { key: input.project },
      issuetype: { name: input.issueType || 'Task' },
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
    if (status) {
      await transition(conn, issue, status, notes);
      issue = (await jira.getIssue(conn, issue.id)) ?? issue;
    }
    return { issue, notes };
  },

  async updateIssue(conn, issue, patch) {
    const notes: string[] = [];
    const { status, statusName: _ignored, ...rest } = patch;
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
    if (status) await transition(conn, issue, status, notes);
    return notes;
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
