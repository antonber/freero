// Test-only Jira: the subset of Jira's public REST API Freero's tracker sync uses, in memory, for
// `npm run verify` (and the UI by hand). Never a real Atlassian site.
//
//   Cloud        /rest/api/3/… (descriptions in ADF), Basic email:token, or an OAuth access token
//                through the gateway path /ex/jira/<cloudId>/rest/api/3/… (with /authorize,
//                /oauth/token and /oauth/token/accessible-resources like auth.atlassian.com).
//   Data Center  /rest/api/2/… (descriptions in wiki markup), Bearer personal access token.
//
// Checks drive it like people in Jira would: `edit(key, …)` changes an issue (bumping `updated`),
// `webhook(url, secret, key)` posts a signed delivery, `forbidTransition(key, category)` makes a
// workflow refuse a move, `rateLimitNext(n, seconds)` answers the next calls 429. Every request is
// recorded (method, path, auth header kind — never the secret) in `requests`.
//
// Jira Software's agile API too (#119): project WEB has a scrum board with sprints 1 (closed),
// 2 (active) and 3 (future); `edit(key, { sprint: id | null })` moves an issue like the backlog
// view does, `closeSprint(id)` completes one. A select custom field "Team" (customfield_10050,
// options Web / Mobile / Platform) stands for the custom fields a field map pairs (#43).
//
//   node scripts/lib/mock-jira.mjs --port 4482 [--deployment datacenter]

import { createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const STATUSES = {
  todo: { name: 'To Do', statusCategory: { key: 'new' } },
  doing: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
  review: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
  done: { name: 'Done', statusCategory: { key: 'done' } },
};
const TRANSITIONS = [
  { id: '11', name: 'Start', to: 'doing' },
  { id: '21', name: 'Review', to: 'review' },
  { id: '31', name: 'Finish', to: 'done' },
  { id: '41', name: 'Reopen', to: 'todo' },
];
/** The site's priority scheme, most pressing first (GET /priority). */
const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
const ESTIMATE = 'customfield_10016';
const START = 'customfield_10015';
const SPRINT = 'customfield_10020';
const TEAM = 'customfield_10050';
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Plain text of an ADF doc or wiki string (what a check compares). */
export function plainOf(description) {
  if (typeof description === 'string') return description;
  const walk = (n) => (n?.type === 'text' ? (n.text ?? '') : (n?.content ?? []).map(walk).join(n?.type === 'paragraph' || n?.type === 'listItem' ? '\n' : ''));
  return walk(description).trim();
}

export async function startMockJira({ port = 0, host = '127.0.0.1', deployment = 'cloud', email = 'bot@jira.test', token = 'jira-api-token', clientId = 'freero-oauth-app', clientSecret = 'oauth-secret', tokenTtlSeconds = 3600 } = {}) {
  const v = deployment === 'cloud' ? '3' : '2';
  const requests = [];
  const issues = new Map(); // id -> issue
  const byKey = new Map();
  const counters = new Map(); // project -> n
  const forbidden = new Map(); // id -> Set(category)
  const projects = [
    { id: '10000', key: 'WEB', name: 'Web app' },
    { id: '10001', key: 'OPS', name: 'Operations' },
  ];
  const users = [];
  const sprints = [
    { id: 1, name: 'WEB Sprint 1', state: 'closed', startDate: day(-28), endDate: day(-14), originBoardId: 1 },
    { id: 2, name: 'WEB Sprint 2', state: 'active', startDate: day(-7), endDate: day(7), originBoardId: 1 },
    { id: 3, name: 'WEB Sprint 3', state: 'future', startDate: day(7), endDate: day(21), originBoardId: 1 },
  ];
  const boards = [{ id: 1, name: 'WEB board', type: 'scrum', location: { projectKey: 'WEB' } }];
  const sprintView = (s) => ({ id: s.id, name: s.name, state: s.state, boardId: s.originBoardId, startDate: s.startDate, endDate: s.endDate });
  /** Puts the issue in sprint `id` (its closed sprints stay in its history), or none. */
  const moveSprint = (issue, id) => {
    const past = (issue.fields[SPRINT] ?? []).filter((s) => sprints.find((x) => x.id === s.id)?.state === 'closed');
    const to = id === null ? null : sprints.find((s) => s.id === Number(id));
    issue.fields[SPRINT] = [...past, ...(to && to.state !== 'closed' ? [sprintView(to)] : [])].map((s) => sprintView(sprints.find((x) => x.id === s.id)));
    if (!issue.fields[SPRINT].length) issue.fields[SPRINT] = null;
  };
  let rateLimited = 0;
  let rateLimitSeconds = 1;
  let nextId = 10_001;
  const oauth = { codes: new Map(), access: new Map(), refresh: new Map() };
  let url = '';

  const addUser = (userEmail, name) => {
    const u = { accountId: `acc-${users.length + 1}`, name: `user${users.length + 1}`, emailAddress: userEmail, displayName: name };
    users.push(u);
    return u;
  };
  const now = () => new Date().toISOString().replace('Z', '+0000');
  const touch = (issue) => (issue.fields.updated = now());
  /** Issue links of type Blocks (#50): `blocker` (its inward issue) blocks `blocked` (the outward one). */
  const links = [];
  let linkSeq = 20_001;
  const BLOCKS = { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
  const linksOf = (issue) =>
    links
      .filter((l) => l.blocker === issue.id || l.blocked === issue.id)
      .map((l) => {
        const other = issues.get(l.blocker === issue.id ? l.blocked : l.blocker);
        const ref = { id: other.id, key: other.key };
        return l.blocker === issue.id ? { id: l.id, type: BLOCKS, outwardIssue: ref } : { id: l.id, type: BLOCKS, inwardIssue: ref };
      });
  const view = (issue, fields) => {
    const f = { ...issue.fields, status: STATUSES[issue.status], issuelinks: linksOf(issue) };
    if (fields) for (const k of Object.keys(f)) if (!fields.includes(k)) delete f[k];
    return { id: issue.id, key: issue.key, self: `${url}/rest/api/${v}/issue/${issue.id}`, fields: f };
  };
  const find = (idOrKey) => issues.get(idOrKey) ?? byKey.get(idOrKey) ?? null;

  function create(projectKey, fields) {
    const n = (counters.get(projectKey) ?? 0) + 1;
    counters.set(projectKey, n);
    const id = String(nextId++);
    const project = projects.find((p) => p.key === projectKey);
    const issue = { id, key: `${projectKey}-${n}`, status: 'todo', fields: { summary: '', description: null, labels: [], duedate: null, assignee: null, [ESTIMATE]: null, [START]: null, [SPRINT]: null, [TEAM]: null, project: project ? { key: project.key, name: project.name } : undefined, ...fields }, remotelinks: new Map() };
    touch(issue);
    issues.set(id, issue);
    byKey.set(issue.key, issue);
    return issue;
  }

  /** People editing in Jira (no webhook: checks send one when they want). */
  function edit(key, changes) {
    const issue = find(key);
    if (!issue) throw new Error(`no issue ${key}`);
    if (changes.summary !== undefined) issue.fields.summary = changes.summary;
    if (changes.description !== undefined)
      issue.fields.description = deployment === 'cloud' ? { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: changes.description }] }] } : changes.description;
    if (changes.status !== undefined) issue.status = changes.status;
    if (changes.priority !== undefined) issue.fields.priority = changes.priority ? { name: changes.priority } : null;
    if (changes.labels !== undefined) issue.fields.labels = changes.labels;
    if (changes.estimate !== undefined) issue.fields[ESTIMATE] = changes.estimate;
    if (changes.duedate !== undefined) issue.fields.duedate = changes.duedate;
    if (changes.startdate !== undefined) issue.fields[START] = changes.startdate;
    if (changes.sprint !== undefined) moveSprint(issue, changes.sprint);
    if (changes.team !== undefined) issue.fields[TEAM] = changes.team ? { value: changes.team, id: changes.team } : null;
    if (changes.assigneeEmail !== undefined) {
      const u = users.find((x) => x.emailAddress === changes.assigneeEmail) ?? addUser(changes.assigneeEmail, changes.assigneeEmail.split('@')[0]);
      issue.fields.assignee = changes.assigneeEmail === null ? null : u;
    }
    touch(issue);
    return issue;
  }

  // ---- JQL (the clauses Freero and the checks use) ----
  function jql(query) {
    const clauses = query.split(/\s+AND\s+/i).map((c) => c.trim()).filter(Boolean);
    const tests = clauses.map((c) => {
      let m;
      if ((m = /^project\s*=\s*"?([A-Z][A-Z0-9]*)"?$/i.exec(c))) return (i) => i.key.startsWith(`${m[1].toUpperCase()}-`);
      if ((m = /^(id|key|issuekey)\s+in\s*\(([^)]*)\)$/i.exec(c))) {
        const set = new Set(m[2].split(',').map((s) => s.trim().replace(/"/g, '')));
        return (i) => set.has(i.id) || set.has(i.key);
      }
      if ((m = /^updated\s*>=\s*"-(\d+)m"$/i.exec(c))) {
        const since = Date.now() - Number(m[1]) * 60_000;
        return (i) => Date.parse(i.fields.updated.replace('+0000', 'Z')) >= since;
      }
      if ((m = /^labels\s*=\s*"?([^"]+)"?$/i.exec(c))) return (i) => i.fields.labels.includes(m[1]);
      if ((m = /^sprint\s*=\s*(\d+)$/i.exec(c))) return (i) => (i.fields[SPRINT] ?? []).some((s) => s.id === Number(m[1]) && s.state !== 'closed');
      if ((m = /^parent\s*=\s*"?([A-Z][A-Z0-9]*-\d+)"?$/i.exec(c))) return (i) => i.fields.parent?.key === m[1].toUpperCase();
      throw Object.assign(new Error(`Error in the JQL Query: unsupported clause '${c}'`), { jql: true });
    });
    return [...issues.values()].filter((i) => tests.every((t) => t(i)));
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const raw = await readBody(req);
    const auth = req.headers.authorization ?? '';
    requests.push({ method: req.method, path: u.pathname, query: u.search, auth: auth.split(' ')[0] ?? '', body: raw });
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      /* form or empty */
    }

    // ---- Atlassian OAuth 2.0 (3LO) ----
    if (u.pathname === '/authorize' && req.method === 'GET') {
      if (u.searchParams.get('client_id') !== clientId) return json(400, { error: 'invalid_client' });
      const code = randomBytes(12).toString('hex');
      oauth.codes.set(code, u.searchParams.get('redirect_uri'));
      const back = new URL(u.searchParams.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', u.searchParams.get('state') ?? '');
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (u.pathname === '/oauth/token' && req.method === 'POST') {
      if (body?.client_id !== clientId || body?.client_secret !== clientSecret) return json(401, { error: 'access_denied', error_description: 'Unauthorized' });
      if (body.grant_type === 'authorization_code') {
        if (!oauth.codes.has(body.code) || oauth.codes.get(body.code) !== body.redirect_uri) return json(403, { error: 'invalid_grant' });
        oauth.codes.delete(body.code);
      } else if (body.grant_type === 'refresh_token') {
        if (!oauth.refresh.has(body.refresh_token)) return json(403, { error: 'invalid_grant' });
        oauth.refresh.delete(body.refresh_token);
      } else return json(400, { error: 'unsupported_grant_type' });
      const access = randomBytes(16).toString('hex');
      const refresh = randomBytes(16).toString('hex');
      oauth.access.set(access, Date.now() + tokenTtlSeconds * 1000);
      oauth.refresh.set(refresh, true);
      return json(200, { access_token: access, refresh_token: refresh, expires_in: tokenTtlSeconds, scope: 'read:jira-work write:jira-work', token_type: 'Bearer' });
    }
    if (u.pathname === '/oauth/token/accessible-resources') {
      const t = auth.replace(/^Bearer /, '');
      if (!oauth.access.has(t)) return json(401, { code: 401, message: 'Unauthorized' });
      return json(200, [{ id: 'cloud-1', url, name: 'Mock site', scopes: ['read:jira-work'] }]);
    }

    // ---- REST (directly, or through the OAuth gateway path) ----
    let path = u.pathname;
    let viaGateway = false;
    if (path.startsWith('/ex/jira/cloud-1/')) {
      path = path.slice('/ex/jira/cloud-1'.length);
      viaGateway = true;
    }
    const authed = viaGateway
      ? (() => {
          const t = auth.replace(/^Bearer /, '');
          const exp = oauth.access.get(t);
          return !!exp && exp > Date.now();
        })()
      : deployment === 'cloud'
        ? auth === `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
        : auth === `Bearer ${token}`;
    if (!authed) return json(401, { errorMessages: ['You are not authenticated. Authentication required to perform this operation.'] });
    if (rateLimited > 0) {
      rateLimited--;
      return json(429, { errorMessages: ['Rate limit exceeded.'] }, { 'retry-after': String(rateLimitSeconds) });
    }
    const p = `/rest/api/${v}`;
    let m;
    if (path === `${p}/priority`) return json(200, PRIORITIES.map((name, i) => ({ id: String(i + 1), name })));
    if (path === `${p}/issueLink` && req.method === 'POST') {
      const a = find(String(body?.inwardIssue?.id ?? body?.inwardIssue?.key ?? ''));
      const b = find(String(body?.outwardIssue?.id ?? body?.outwardIssue?.key ?? ''));
      if (!a || !b) return json(404, { errorMessages: ['Issue Does Not Exist'] });
      if (body?.type?.name !== 'Blocks') return json(404, { errorMessages: ['No issue link type with name found.'] });
      if (!links.some((l) => l.blocker === a.id && l.blocked === b.id)) links.push({ id: String(linkSeq++), blocker: a.id, blocked: b.id });
      touch(a);
      touch(b);
      return json(201, {});
    }
    if ((m = new RegExp(`^${p}/issueLink/(\\d+)$`).exec(path)) && req.method === 'DELETE') {
      const at = links.findIndex((l) => l.id === m[1]);
      if (at < 0) return json(404, { errorMessages: ['No issue link with id exists.'] });
      const [l] = links.splice(at, 1);
      for (const id of [l.blocker, l.blocked]) touch(issues.get(id));
      return json(204, {});
    }
    if (path === `${p}/myself`) return json(200, { accountId: 'acc-bot', name: 'freero-bot', emailAddress: email, displayName: 'Freero bot' });
    if (path === `${p}/field`)
      return json(200, [
        { id: 'summary', name: 'Summary', custom: false, schema: { type: 'string', system: 'summary' } },
        { id: ESTIMATE, name: 'Story point estimate', custom: true, schema: { type: 'number', custom: 'com.pyxis.greenhopper.jira:jsw-story-points' } },
        { id: START, name: 'Start date', custom: true, schema: { type: 'date', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:datepicker' } },
        { id: SPRINT, name: 'Sprint', custom: true, schema: { type: 'array', items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
        { id: TEAM, name: 'Team', custom: true, schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } },
      ]);
    if ((m = new RegExp(`^${p}/issue/createmeta/([^/]+)/issuetypes$`).exec(path))) {
      if (!projects.some((x) => x.key === m[1])) return json(404, { errorMessages: ['No project could be found'] });
      const types = [{ name: 'Task', subtask: false }, { name: 'Bug', subtask: false }, { name: 'Story', subtask: false }, { name: 'Epic', subtask: false }, { name: 'Sub-task', subtask: true }];
      return json(200, deployment === 'cloud' ? { issueTypes: types, total: types.length } : { values: types, total: types.length });
    }
    // ---- agile (Jira Software) ----
    if (path === '/rest/agile/1.0/board' && req.method === 'GET') {
      const key = u.searchParams.get('projectKeyOrId');
      return json(200, { values: boards.filter((b) => !key || b.location.projectKey === key), isLast: true });
    }
    if ((m = /^\/rest\/agile\/1\.0\/board\/(\d+)\/sprint$/.exec(path)) && req.method === 'GET') {
      const at = Number(u.searchParams.get('startAt') ?? 0);
      const mine = sprints.filter((s) => s.originBoardId === Number(m[1]));
      return json(200, { values: mine.slice(at, at + 50).map(sprintView), isLast: at + 50 >= mine.length });
    }
    if ((m = /^\/rest\/agile\/1\.0\/sprint\/(\d+)\/issue$/.exec(path)) && req.method === 'POST') {
      const s = sprints.find((x) => x.id === Number(m[1]));
      if (!s) return json(404, { errorMessages: ['Sprint does not exist'] });
      if (s.state === 'closed') return json(400, { errorMessages: ['Cannot move issues to a closed sprint'] });
      for (const k of body?.issues ?? []) {
        const issue = find(k);
        if (!issue) return json(400, { errorMessages: [`Issue ${k} does not exist`] });
        moveSprint(issue, s.id);
        touch(issue);
      }
      res.writeHead(204);
      return res.end();
    }
    if (path === '/rest/agile/1.0/backlog/issue' && req.method === 'POST') {
      for (const k of body?.issues ?? []) {
        const issue = find(k);
        if (issue) {
          moveSprint(issue, null);
          touch(issue);
        }
      }
      res.writeHead(204);
      return res.end();
    }
    if (path === '/rest/api/3/project/search' && deployment === 'cloud') return json(200, { values: projects, isLast: true });
    if (path === '/rest/api/2/project' && deployment !== 'cloud') return json(200, projects);
    if (path === `${p}/user/search`) {
      const q = (u.searchParams.get(deployment === 'cloud' ? 'query' : 'username') ?? '').toLowerCase();
      return json(200, users.filter((x) => x.emailAddress.toLowerCase() === q));
    }
    if (path === `${p}/issue` && req.method === 'POST') {
      const f = body?.fields ?? {};
      const project = projects.find((x) => x.key === f.project?.key);
      if (!project) return json(400, { errorMessages: [], errors: { project: 'valid project is required' } });
      if (!f.summary) return json(400, { errorMessages: [], errors: { summary: 'You must specify a summary of the issue.' } });
      if (deployment === 'cloud' && f.description && typeof f.description !== 'object') return json(400, { errors: { description: 'Operation value must be an Atlassian Document' } });
      if (deployment !== 'cloud' && f.description && typeof f.description !== 'string') return json(400, { errors: { description: 'Operation value must be a string' } });
      const assignee = f.assignee ? users.find((x) => x.accountId === f.assignee.accountId || x.name === f.assignee.name) : null;
      if (f.priority && !PRIORITIES.includes(f.priority.name)) return json(400, { errorMessages: [], errors: { priority: 'Specify a valid priority' } });
      const parent = f.parent?.key ? find(f.parent.key) : null;
      if (f.parent?.key && !parent) return json(400, { errorMessages: [], errors: { parent: 'Could not find issue by id or key.' } });
      const issue = create(project.key, {
        summary: f.summary,
        description: f.description ?? null,
        labels: f.labels ?? [],
        duedate: f.duedate ?? null,
        assignee: assignee ?? null,
        priority: f.priority ?? { name: 'Medium' },
        issuetype: { name: f.issuetype?.name ?? 'Task' },
        [ESTIMATE]: f[ESTIMATE] ?? null,
        [START]: f[START] ?? null,
        [TEAM]: f[TEAM] ?? null,
        ...(parent ? { parent: { key: parent.key, fields: { summary: parent.fields.summary } } } : {}),
      });
      return json(201, { id: issue.id, key: issue.key, self: `${url}${p}/issue/${issue.id}` });
    }
    if ((m = new RegExp(`^${p}/issue/([^/]+)$`).exec(path))) {
      const issue = find(decodeURIComponent(m[1]));
      if (!issue) return json(404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] });
      if (req.method === 'GET') return json(200, view(issue, u.searchParams.get('fields')?.split(',')));
      if (req.method === 'PUT') {
        const f = body?.fields ?? {};
        for (const [k, val] of Object.entries(f)) {
          if (k === 'assignee') issue.fields.assignee = val ? (users.find((x) => x.accountId === val.accountId || x.name === val.name) ?? null) : null;
          else issue.fields[k] = val;
        }
        touch(issue);
        res.writeHead(204);
        return res.end();
      }
    }
    if ((m = new RegExp(`^${p}/issue/([^/]+)/transitions$`).exec(path))) {
      const issue = find(decodeURIComponent(m[1]));
      if (!issue) return json(404, { errorMessages: ['Issue does not exist'] });
      const allowed = TRANSITIONS.filter((t) => t.to !== issue.status && !forbidden.get(issue.id)?.has(t.to)).map((t) => ({ id: t.id, name: t.name, to: STATUSES[t.to] }));
      if (req.method === 'GET') return json(200, { transitions: allowed });
      const t = allowed.find((x) => x.id === body?.transition?.id);
      if (!t) return json(400, { errorMessages: ['Transition id is not valid for this issue.'] });
      issue.status = TRANSITIONS.find((x) => x.id === t.id).to;
      touch(issue);
      res.writeHead(204);
      return res.end();
    }
    if ((m = new RegExp(`^${p}/issue/([^/]+)/remotelink$`).exec(path))) {
      const issue = find(decodeURIComponent(m[1]));
      if (!issue) return json(404, { errorMessages: ['Issue does not exist'] });
      if (req.method === 'GET') return json(200, [...issue.remotelinks.values()]);
      if (req.method === 'POST') {
        const known = issue.remotelinks.has(body.globalId);
        issue.remotelinks.set(body.globalId, { id: issue.remotelinks.size + 1, ...body });
        return json(known ? 200 : 201, { id: 1, self: `${url}${p}/issue/${issue.id}/remotelink/1` });
      }
      if (req.method === 'DELETE') {
        issue.remotelinks.delete(u.searchParams.get('globalId'));
        res.writeHead(204);
        return res.end();
      }
    }
    if ((deployment === 'cloud' && path === '/rest/api/3/search/jql' && req.method === 'POST') || (deployment !== 'cloud' && path === '/rest/api/2/search' && req.method === 'POST')) {
      try {
        const found = jql(body?.jql ?? '').slice(0, body?.maxResults ?? 50);
        return json(200, { issues: found.map((i) => view(i, body?.fields)), isLast: true });
      } catch (e) {
        return json(400, { errorMessages: [e.message] });
      }
    }
    return json(404, { errorMessages: [`no route ${req.method} ${path}`] });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  url = `http://${host}:${server.address().port}`;
  return {
    url,
    deployment,
    email,
    token,
    clientId,
    clientSecret,
    requests,
    issues,
    addUser,
    create,
    edit,
    /** People in Jira (#50): `blocker` blocks `blocked` (keys), a Blocks issue link; `unblock` removes it. */
    block(blocker, blocked) {
      const a = find(blocker);
      const b = find(blocked);
      links.push({ id: String(linkSeq++), blocker: a.id, blocked: b.id });
      touch(a);
      touch(b);
    },
    unblock(blocker, blocked) {
      const a = find(blocker);
      const b = find(blocked);
      const at = links.findIndex((l) => l.blocker === a.id && l.blocked === b.id);
      if (at >= 0) links.splice(at, 1);
      touch(a);
      touch(b);
    },
    blocks: (key) => links.filter((l) => l.blocker === find(key).id).map((l) => issues.get(l.blocked).key),
    issue: (key) => {
      const i = find(key);
      const open = (i?.fields[SPRINT] ?? []).find((s) => s.state !== 'closed');
      return i
        ? {
            ...i,
            statusCategory: STATUSES[i.status].statusCategory.key,
            statusName: STATUSES[i.status].name,
            text: plainOf(i.fields.description),
            remotelinks: [...i.remotelinks.values()],
            sprint: open?.name ?? null,
            team: i.fields[TEAM]?.value ?? null,
          }
        : null;
    },
    sprints,
    closeSprint: (id) => {
      const s = sprints.find((x) => x.id === Number(id));
      s.state = 'closed';
      for (const i of issues.values()) if (i.fields[SPRINT]) i.fields[SPRINT] = i.fields[SPRINT].map((x) => sprintView(sprints.find((y) => y.id === x.id)));
    },

    forbidTransition: (key, category) => {
      const i = find(key);
      forbidden.set(i.id, new Set([...(forbidden.get(i.id) ?? []), category]));
    },
    rateLimitRemaining: () => rateLimited,
    rateLimitNext: (n, seconds = 1) => {
      rateLimited = n;
      rateLimitSeconds = seconds;
    },
    /** Posts a Jira webhook about `key`, signed with `secret` (X-Hub-Signature), to `target`. */
    async webhook(target, secret, key, event = 'jira:issue_updated') {
      const i = find(key);
      const payload = Buffer.from(JSON.stringify({ timestamp: Date.now(), webhookEvent: event, issue: { id: i.id, key: i.key, self: `${url}/rest/api/${v}/issue/${i.id}` } }));
      const sig = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
      const r = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature': sig }, body: payload });
      return r.status;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : dflt;
  };
  const j = await startMockJira({ port: Number(arg('--port', '4482')), deployment: arg('--deployment', 'cloud') });
  j.addUser('demo@freero.app', 'Demo User');
  console.log(`mock Jira ${j.deployment} on ${j.url} (email ${j.email}, token ${j.token}; projects WEB, OPS)`);
}
