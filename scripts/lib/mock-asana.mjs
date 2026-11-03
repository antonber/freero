// Test-only Asana: the subset of Asana's REST API (https://app.asana.com/api/1.0) Freero's tracker
// sync uses (#120), in memory, for `npm run verify` and the UI by hand. Never a real workspace.
//
//   API    http://127.0.0.1:<port>/api/1.0/…  ({ data } in, { data } out), a personal access token as Bearer
//   OAuth  /-/oauth_authorize and /-/oauth_token (client id / secret below)
//
// Workspace "Acme" has project "Launch" with sections To do, In progress and Done, an enum custom
// field Team (Web / Mobile) on its tasks, and a project "Ops". Asana's own search answers 402 (a
// free plan). A start date needs a due date, like Asana insists.
//
// Webhooks behave like Asana's: POST /webhooks first posts the handshake (X-Hook-Secret) to the
// target and creates the webhook only if the answer echoes it; then every change to a task of the
// project is delivered there, signed (X-Hook-Signature: HMAC-SHA256 of the body with that secret).
// Checks drive it like people in Asana would: `edit(gid, changes)` (delivered like Asana would),
// `editBeforeNextWrite(gid, changes)` (someone edits between Freero's read and its write),
// `forge(target, gid)` (a delivery signed with another secret), `handshakeAgain(target)`.
//
//   node scripts/lib/mock-asana.mjs --port 4485

import { createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function startMockAsana({ port = 0, host = '127.0.0.1', token = 'asana-pat' } = {}) {
  const requests = [];
  let seq = 1200000000000000;
  const gid = () => String(++seq);
  const workspace = { gid: '1100000000000001', name: 'Acme' };
  const users = [{ gid: '1100000000000101', email: 'bot@asana.test', name: 'Freero bot' }];
  const me = users[0];
  const projects = [
    { gid: '1100000000000201', name: 'Launch', sections: [] },
    { gid: '1100000000000202', name: 'Ops', sections: [] },
  ];
  for (const p of projects) p.sections = ['To do', 'In progress', 'Done'].map((name) => ({ gid: gid(), name }));
  const team = { gid: '1100000000000301', name: 'Team', resource_subtype: 'enum', enum_options: [{ gid: '1100000000000311', name: 'Web', enabled: true }, { gid: '1100000000000312', name: 'Mobile', enabled: true }] };
  const tags = [];
  const tasks = new Map();
  const attachments = [];
  const webhooks = [];
  const pendingEdits = [];
  const deliveries = [];
  const oauth = { clientId: 'asana-client', clientSecret: 'asana-client-secret', codes: new Map(), tokens: new Set([token]) };
  let url = '';

  const userOf = (ref) => (ref === null || ref === undefined ? null : users.find((u) => u.gid === ref || u.email.toLowerCase() === String(ref).toLowerCase()) ?? null);
  const touch = (t) => (t.modified_at = new Date().toISOString());
  const projectOf = (p) => projects.find((x) => x.gid === p);

  function view(t) {
    const assignee = userOf(t.assignee);
    return {
      gid: t.gid,
      resource_type: 'task',
      name: t.name,
      html_notes: t.html_notes,
      completed: t.completed,
      assignee: assignee ? { gid: assignee.gid, email: assignee.email, name: assignee.name } : null,
      due_on: t.due_on,
      start_on: t.start_on,
      tags: t.tags.map((g) => ({ gid: g, name: tags.find((x) => x.gid === g)?.name })),
      memberships: t.memberships.map((m) => {
        const p = projectOf(m.project);
        const s = p?.sections.find((x) => x.gid === m.section);
        return { project: { gid: p.gid, name: p.name }, section: s ? { gid: s.gid, name: s.name } : null };
      }),
      parent: t.parent ? { gid: t.parent, name: tasks.get(t.parent)?.name } : null,
      modified_at: t.modified_at,
      permalink_url: `https://app.asana.com/0/${t.memberships[0]?.project ?? 0}/${t.gid}`,
      workspace: { gid: workspace.gid, name: workspace.name },
      custom_fields: t.memberships.some((m) => m.project === projects[0].gid)
        ? [{ gid: team.gid, name: team.name, resource_subtype: 'enum', enum_value: team.enum_options.find((o) => o.gid === t.team) ?? null, enum_options: team.enum_options }]
        : [],
    };
  }

  function create(projectGid, fields = {}) {
    const p = projectOf(projectGid);
    const t = { gid: gid(), name: '', html_notes: '<body></body>', completed: false, assignee: null, due_on: null, start_on: null, tags: [], memberships: p ? [{ project: p.gid, section: p.sections[0].gid }] : [], parent: null, team: null, modified_at: '' };
    Object.assign(t, fields);
    touch(t);
    tasks.set(t.gid, t);
    return t;
  }

  /** Asana's validation of a task change; returns an error message or null. */
  function apply(t, data) {
    if (data.name !== undefined) t.name = String(data.name);
    if (data.html_notes !== undefined) {
      if (!/^<body>[\s\S]*<\/body>$/.test(data.html_notes)) return 'html_notes: XML is invalid (it must be inside a <body> element)';
      if (/<p\b|<br\b/.test(data.html_notes)) return 'html_notes: <p> and <br> are not allowed';
      t.html_notes = data.html_notes;
    }
    if (data.due_on !== undefined) t.due_on = data.due_on;
    if (data.start_on !== undefined) {
      if (data.start_on && !(data.due_on !== undefined ? data.due_on : t.due_on)) return 'start_on: You must specify a due date to set a start date';
      t.start_on = data.start_on;
    }
    if (data.assignee !== undefined) {
      if (data.assignee === null) t.assignee = null;
      else {
        const u = userOf(data.assignee);
        if (!u) return `assignee: Not a recognized ID: ${data.assignee}`;
        t.assignee = u.gid;
      }
    }
    if (data.completed !== undefined) t.completed = !!data.completed;
    for (const [fid, v] of Object.entries(data.custom_fields ?? {})) {
      if (fid !== team.gid) return `custom_fields: Custom field with ID ${fid} is not on given object`;
      if (v !== null && !team.enum_options.some((o) => o.gid === v)) return `custom_fields: enum option ${v} is not an option of Team`;
      t.team = v;
    }
    return null;
  }

  const sign = (secret, body) => createHmac('sha256', secret).update(body).digest('hex');

  /** Delivers an event about task `t` to every webhook on one of its projects (like Asana, in the background). */
  async function deliver(t, action = 'changed') {
    const out = [];
    for (const w of webhooks.filter((x) => x.active && t.memberships.some((m) => m.project === x.resource))) {
      const body = JSON.stringify({ events: [{ user: { gid: me.gid, resource_type: 'user' }, created_at: new Date().toISOString(), action, resource: { gid: t.gid, resource_type: 'task', resource_subtype: 'default_task' }, parent: null }] });
      const r = await fetch(w.target, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hook-signature': sign(w.secret, body) }, body }).catch(() => ({ status: 0 }));
      deliveries.push({ webhook: w.gid, task: t.gid, status: r.status });
      out.push(r.status);
    }
    return out;
  }

  /** People editing in Asana. Delivered to the webhooks; resolves with their statuses. */
  async function edit(taskGid, changes) {
    const t = tasks.get(taskGid);
    if (!t) throw new Error(`no task ${taskGid}`);
    if (changes.name !== undefined) t.name = changes.name;
    if (changes.notes !== undefined) t.html_notes = `<body>${changes.notes}</body>`;
    if (changes.completed !== undefined) t.completed = changes.completed;
    if (changes.due_on !== undefined) t.due_on = changes.due_on;
    if (changes.section !== undefined) {
      const m = t.memberships[0];
      m.section = projectOf(m.project).sections.find((s) => s.name === changes.section).gid;
    }
    if (changes.team !== undefined) t.team = team.enum_options.find((o) => o.name === changes.team)?.gid ?? null;
    touch(t);
    return deliver(t);
  }

  const multipart = (raw, type) => {
    const boundary = /boundary=([^;]+)/.exec(type ?? '')?.[1];
    if (!boundary) return null;
    const out = {};
    for (const part of raw.split(`--${boundary}`)) {
      const m = /name="([^"]+)"\r\n\r\n([\s\S]*)\r\n$/.exec(part);
      if (m) out[m[1]] = m[2];
    }
    return out;
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const raw = await readBody(req);
    requests.push({ method: req.method, path: u.pathname, query: u.search, body: raw });
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    const fail = (status, message) => json(status, { errors: [{ message }] });

    // ---- OAuth ----
    if (u.pathname === '/-/oauth_authorize') {
      const code = randomBytes(8).toString('hex');
      oauth.codes.set(code, u.searchParams.get('redirect_uri'));
      res.writeHead(302, { location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(u.searchParams.get('state') ?? '')}` });
      return res.end();
    }
    if (u.pathname === '/-/oauth_token' && req.method === 'POST') {
      const f = new URLSearchParams(raw);
      if (f.get('client_id') !== oauth.clientId || f.get('client_secret') !== oauth.clientSecret) return json(401, { error: 'invalid_client' });
      if (f.get('grant_type') === 'authorization_code' && !oauth.codes.delete(f.get('code'))) return json(400, { error: 'invalid_grant' });
      const access = `asana-oauth-${randomBytes(8).toString('hex')}`;
      oauth.tokens.add(access);
      return json(200, { access_token: access, refresh_token: 'asana-refresh', expires_in: 3600, token_type: 'bearer', data: { gid: me.gid, email: me.email, name: me.name } });
    }

    if (!u.pathname.startsWith('/api/1.0/')) return fail(404, 'Not found');
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!bearer || !oauth.tokens.has(bearer)) return fail(401, 'Not Authorized');
    const path = u.pathname.slice('/api/1.0'.length);
    let body = null;
    if (/json/.test(req.headers['content-type'] ?? '') && raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return fail(400, 'Could not parse request data, invalid JSON');
      }
    }
    const data = body?.data ?? {};
    const page = (list) => {
      const limit = Math.min(100, Number(u.searchParams.get('limit') ?? 100));
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const slice = list.slice(offset, offset + limit);
      return json(200, { data: slice, next_page: offset + limit < list.length ? { offset: String(offset + limit) } : null });
    };
    let m;

    if (path === '/users/me') return json(200, { data: { gid: me.gid, email: me.email, name: me.name, workspaces: [workspace] } });
    if ((m = /^\/users\/([^/]+)$/.exec(path))) {
      const user = userOf(decodeURIComponent(m[1]));
      return user ? json(200, { data: { gid: user.gid, email: user.email, name: user.name } }) : fail(404, 'user: Unknown object');
    }
    if (path === '/projects' && req.method === 'GET') return page(u.searchParams.get('workspace') === workspace.gid ? projects.map((p) => ({ gid: p.gid, name: p.name })) : []);
    if ((m = /^\/projects\/(\d+)\/sections$/.exec(path))) {
      const p = projectOf(m[1]);
      return p ? page(p.sections) : fail(404, 'project: Unknown object');
    }
    if ((m = /^\/projects\/(\d+)\/tasks$/.exec(path))) {
      const p = projectOf(m[1]);
      return p ? page([...tasks.values()].filter((t) => t.memberships.some((x) => x.project === p.gid)).map(view)) : fail(404, 'project: Unknown object');
    }
    if ((m = /^\/workspaces\/(\d+)\/tasks\/search$/.exec(path))) return fail(402, 'Search is only available to premium users.');
    if ((m = /^\/workspaces\/(\d+)\/custom_fields$/.exec(path))) return page([{ gid: team.gid, name: team.name, resource_subtype: team.resource_subtype }]);
    if ((m = /^\/workspaces\/(\d+)\/tags$/.exec(path))) return page(tags);
    if (path === '/tags' && req.method === 'POST') {
      const t = { gid: gid(), name: String(data.name) };
      tags.push(t);
      return json(201, { data: t });
    }
    if (path === '/tasks' && req.method === 'POST') {
      const project = data.projects?.[0];
      if (!project && !data.parent) return fail(400, 'workspace: Missing input');
      if (project && !projectOf(project)) return fail(404, 'projects: Unknown object');
      if (data.parent && !tasks.get(data.parent)) return fail(404, 'parent: Unknown object');
      const t = create(project, { parent: data.parent ?? null });
      const err = apply(t, { ...data, projects: undefined, parent: undefined });
      if (err) {
        tasks.delete(t.gid);
        return fail(400, err);
      }
      return json(201, { data: view(t) });
    }
    if ((m = /^\/tasks\/(\d+)\/subtasks$/.exec(path))) return page([...tasks.values()].filter((t) => t.parent === m[1]).map(view));
    if ((m = /^\/tasks\/(\d+)\/(addTag|removeTag)$/.exec(path)) && req.method === 'POST') {
      const t = tasks.get(m[1]);
      if (!t) return fail(404, 'task: Unknown object');
      if (!tags.some((x) => x.gid === data.tag)) return fail(404, 'tag: Unknown object');
      t.tags = m[2] === 'addTag' ? [...new Set([...t.tags, data.tag])] : t.tags.filter((x) => x !== data.tag);
      touch(t);
      return json(200, { data: {} });
    }
    if ((m = /^\/tasks\/(\d+)$/.exec(path))) {
      const t = tasks.get(m[1]);
      if (!t) return fail(404, 'task: Unknown object');
      if (req.method === 'GET') return json(200, { data: view(t) });
      if (req.method === 'PUT') {
        // Someone else's edit lands between Freero's read and this write.
        const i = pendingEdits.findIndex((p) => p.gid === t.gid);
        if (i >= 0) await edit(t.gid, pendingEdits.splice(i, 1)[0].changes);
        const copy = structuredClone(t);
        const err = apply(copy, data);
        if (err) return fail(400, err);
        Object.assign(t, copy);
        touch(t);
        return json(200, { data: view(t) });
      }
    }
    if ((m = /^\/sections\/(\d+)\/addTask$/.exec(path)) && req.method === 'POST') {
      const t = tasks.get(data.task);
      const p = projects.find((x) => x.sections.some((s) => s.gid === m[1]));
      if (!t || !p) return fail(404, 'section: Unknown object');
      const mem = t.memberships.find((x) => x.project === p.gid);
      if (!mem) return fail(400, 'task: The task is not in the section’s project');
      mem.section = m[1];
      touch(t);
      return json(200, { data: {} });
    }
    if (path === '/batch' && req.method === 'POST') {
      const out = (data.actions ?? []).slice(0, 10).map((a) => {
        const t = tasks.get(/^\/tasks\/(\d+)$/.exec(a.relative_path ?? '')?.[1]);
        return t ? { status_code: 200, body: { data: { gid: t.gid, modified_at: t.modified_at } } } : { status_code: 404, body: { errors: [{ message: 'task: Unknown object' }] } };
      });
      return json(200, { data: out });
    }
    if (path === '/attachments' && req.method === 'GET') return page(attachments.filter((a) => a.parent === u.searchParams.get('parent')).map(({ parent: _p, ...a }) => a));
    if (path === '/attachments' && req.method === 'POST') {
      const f = multipart(raw, req.headers['content-type']);
      if (!f) return fail(400, 'file: Missing input (attachments are uploaded as multipart/form-data)');
      if (!tasks.get(f.parent)) return fail(404, 'parent: Unknown object');
      if (f.resource_subtype !== 'external' || !/^https?:\/\//.test(f.url ?? '')) return fail(400, 'url: Missing input');
      const a = { gid: gid(), name: f.name, resource_subtype: 'external', view_url: f.url, parent: f.parent };
      attachments.push(a);
      return json(200, { data: a });
    }
    if ((m = /^\/attachments\/(\d+)$/.exec(path)) && req.method === 'DELETE') {
      const i = attachments.findIndex((a) => a.gid === m[1]);
      if (i < 0) return fail(404, 'attachment: Unknown object');
      attachments.splice(i, 1);
      return json(200, { data: {} });
    }
    if (path === '/webhooks' && req.method === 'POST') {
      if (!projectOf(data.resource)) return fail(404, 'resource: Unknown object');
      // The handshake, before answering: the target must echo the secret.
      const secret = randomBytes(16).toString('hex');
      const r = await fetch(data.target, { method: 'POST', headers: { 'x-hook-secret': secret } }).catch(() => null);
      if (!r || (r.status !== 200 && r.status !== 204) || r.headers.get('x-hook-secret') !== secret) return fail(400, 'The remote server did not respond with the handshake secret.');
      const w = { gid: gid(), resource: data.resource, target: data.target, secret, active: true, filters: data.filters ?? [] };
      webhooks.push(w);
      return json(201, { data: { gid: w.gid, resource: { gid: w.resource }, target: w.target, active: true } });
    }
    if ((m = /^\/webhooks\/(\d+)$/.exec(path)) && req.method === 'DELETE') {
      const i = webhooks.findIndex((w) => w.gid === m[1]);
      if (i < 0) return fail(404, 'webhook: Unknown object');
      webhooks.splice(i, 1);
      return json(200, { data: {} });
    }
    return fail(404, `mock: no route ${req.method} ${path}`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  url = `http://${host}:${server.address().port}`;
  return {
    url,
    site: url,
    token,
    oauth: { clientId: oauth.clientId, clientSecret: oauth.clientSecret },
    project: projects[0].gid,
    projects,
    team,
    requests,
    webhooks,
    deliveries,
    addUser: (email, name) => users.push({ gid: gid(), email, name }),
    create: (projectGid, fields) => view(create(projectGid ?? projects[0].gid, fields)),
    task: (taskGid) => {
      const t = tasks.get(taskGid);
      if (!t) return null;
      const v = view(t);
      return { ...v, section: v.memberships[0]?.section?.name ?? null, team: v.custom_fields[0]?.enum_value?.name ?? null, tagNames: v.tags.map((x) => x.name), attachments: attachments.filter((a) => a.parent === t.gid) };
    },
    edit,
    /** The next PUT of task `gid` finds it changed by someone else first. */
    editBeforeNextWrite: (taskGid, changes) => pendingEdits.push({ gid: taskGid, changes }),
    /** A delivery about `gid` signed with a secret that isn't the webhook's. */
    async forge(target, taskGid) {
      const body = JSON.stringify({ events: [{ action: 'changed', resource: { gid: taskGid, resource_type: 'task' } }] });
      const r = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hook-signature': sign('not-the-secret', body) }, body });
      return r.status;
    },
    /** A second handshake for an address already registered (someone trying to swap the secret). */
    async handshakeAgain(target) {
      const r = await fetch(target, { method: 'POST', headers: { 'x-hook-secret': 'a-secret-of-their-own' } });
      return r.status;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--port');
  const a = await startMockAsana({ port: Number(i >= 0 ? process.argv[i + 1] : 4485) });
  a.addUser('demo@freero.app', 'Demo User');
  a.create(a.project, { name: 'Launch checklist' });
  console.log(`mock Asana at ${a.url} (personal access token ${a.token}; project Launch ${a.project})`);
}
