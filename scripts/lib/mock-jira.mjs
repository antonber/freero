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
const ESTIMATE = 'customfield_10016';

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
  const view = (issue, fields) => {
    const f = { ...issue.fields, status: STATUSES[issue.status] };
    if (fields) for (const k of Object.keys(f)) if (!fields.includes(k)) delete f[k];
    return { id: issue.id, key: issue.key, self: `${url}/rest/api/${v}/issue/${issue.id}`, fields: f };
  };
  const find = (idOrKey) => issues.get(idOrKey) ?? byKey.get(idOrKey) ?? null;

  function create(projectKey, fields) {
    const n = (counters.get(projectKey) ?? 0) + 1;
    counters.set(projectKey, n);
    const id = String(nextId++);
    const issue = { id, key: `${projectKey}-${n}`, status: 'todo', fields: { summary: '', description: null, labels: [], duedate: null, assignee: null, [ESTIMATE]: null, ...fields }, remotelinks: new Map() };
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
    if (changes.labels !== undefined) issue.fields.labels = changes.labels;
    if (changes.estimate !== undefined) issue.fields[ESTIMATE] = changes.estimate;
    if (changes.duedate !== undefined) issue.fields.duedate = changes.duedate;
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
    if (path === `${p}/myself`) return json(200, { accountId: 'acc-bot', name: 'freero-bot', emailAddress: email, displayName: 'Freero bot' });
    if (path === `${p}/field`)
      return json(200, [
        { id: 'summary', name: 'Summary' },
        { id: ESTIMATE, name: 'Story point estimate' },
      ]);
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
      const issue = create(project.key, { summary: f.summary, description: f.description ?? null, labels: f.labels ?? [], duedate: f.duedate ?? null, assignee: assignee ?? null, [ESTIMATE]: f[ESTIMATE] ?? null });
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
    issue: (key) => {
      const i = find(key);
      return i ? { ...i, statusCategory: STATUSES[i.status].statusCategory.key, statusName: STATUSES[i.status].name, text: plainOf(i.fields.description), remotelinks: [...i.remotelinks.values()] } : null;
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
