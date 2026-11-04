// Test-only ClickUp: the subset of ClickUp's REST API v2 (https://api.clickup.com/api/v2) Freero's
// tracker sync uses (#180), in memory, for `npm run verify` and the UI by hand. Never a real
// Workspace.
//
//   API    http://127.0.0.1:<port>/api/v2/…  a personal token (pk_…) or an OAuth access token as the
//          Authorization header, as it is
//   OAuth  /api (the consent page) and POST /api/v2/oauth/token?client_id&client_secret&code
//
// Workspace "Acme" has Space "Product" with Folder "Web" holding List "Sprint board" (statuses
// to do · in progress · in review · complete, the last of type closed) and a folderless List
// "Backlog"; a drop-down custom field "Team" (Web / Mobile). Members carry their email addresses.
//
// Webhooks behave like ClickUp's: POST /team/:id/webhook answers with the webhook and the secret it
// signs deliveries with; every change people make to a task of its List is then delivered there,
// signed (X-Signature: HMAC-SHA256 hex of the body). Checks drive it like people in ClickUp would:
// `edit(id, changes)` (delivered like ClickUp would), `editBeforeNextWrite(id, changes)` (someone
// edits between Freero's read and its write), `forge(target, id)` (a delivery signed with another
// secret), `depend(taskId, dependsOn)` / `undepend(…)` (dependencies made there, #50).
//
//   node scripts/lib/mock-clickup.mjs --port 4487

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

const PRIORITY = [null, 'urgent', 'high', 'normal', 'low'];

export async function startMockClickUp({ port = 0, host = '127.0.0.1', token = 'pk_8812_MOCKTOKEN' } = {}) {
  const requests = [];
  let seq = 0;
  const tid = () => `86a${(++seq).toString(36).padStart(5, '0')}`;
  let nseq = 901200000;
  const nid = () => String(++nseq);
  const team = { id: '9012345', name: 'Acme' };
  const users = [{ id: 81001, username: 'Freero bot', email: 'bot@clickup.test' }];
  const me = users[0];
  const space = { id: '90150001', name: 'Product', tags: [] };
  const statuses = [
    { status: 'to do', type: 'open', orderindex: 0 },
    { status: 'in progress', type: 'custom', orderindex: 1 },
    { status: 'in review', type: 'custom', orderindex: 2 },
    { status: 'complete', type: 'closed', orderindex: 3 },
  ];
  const folder = { id: '90160001', name: 'Web' };
  const lists = [
    { id: '901700001', name: 'Sprint board', folder, statuses },
    { id: '901700002', name: 'Backlog', folder: { id: '90160002', name: 'hidden' }, statuses },
  ];
  const teamField = { id: 'a1b2c3d4-team', name: 'Team', type: 'drop_down', type_config: { options: [{ id: 'opt-web', name: 'Web', orderindex: 0 }, { id: 'opt-mobile', name: 'Mobile', orderindex: 1 }] } };
  const tasks = new Map();
  const comments = [];
  const webhooks = [];
  const deliveries = [];
  const pendingEdits = [];
  const oauth = { clientId: 'clickup-client', clientSecret: 'clickup-client-secret', codes: new Set(), tokens: new Set([token]) };
  let url = '';

  const listOf = (id) => lists.find((l) => l.id === id);
  const userOf = (id) => users.find((u) => String(u.id) === String(id)) ?? null;
  const touch = (t) => (t.date_updated = String(Date.now()));

  function view(t) {
    const l = listOf(t.list);
    return {
      id: t.id,
      custom_id: null,
      name: t.name,
      text_content: t.markdown.replace(/[*_`#>]/g, ''),
      description: t.markdown.replace(/[*_`#>]/g, ''),
      markdown_description: t.markdown,
      status: { ...statuses.find((s) => s.status === t.status) },
      date_updated: t.date_updated,
      assignees: t.assignees.map((id) => ({ ...userOf(id) })),
      tags: t.tags.map((name) => ({ name })),
      due_date: t.due_date,
      start_date: t.start_date,
      points: t.points,
      priority: t.priority ? { id: String(t.priority), priority: PRIORITY[t.priority] } : null,
      parent: t.parent,
      list: { id: l.id, name: l.name },
      folder: { id: l.folder.id, name: l.folder.name },
      space: { id: space.id },
      url: `https://app.clickup.com/t/${t.id}`,
      team_id: team.id,
      custom_fields: [{ ...teamField, value: t.team ?? undefined }],
      dependencies: t.dependsOn.map((d) => ({ task_id: t.id, depends_on: d, type: 1 })).concat([...tasks.values()].filter((x) => x.dependsOn.includes(t.id)).map((x) => ({ task_id: x.id, depends_on: t.id, type: 1 }))),
    };
  }

  function create(listId, fields = {}) {
    const t = { id: tid(), name: 'Untitled', markdown: '', status: 'to do', assignees: [], tags: [], due_date: null, start_date: null, points: null, priority: null, parent: null, list: listId, team: null, dependsOn: [], date_updated: '' };
    Object.assign(t, fields);
    touch(t);
    tasks.set(t.id, t);
    return t;
  }

  /** ClickUp's validation of a task change; returns an error message or null. */
  function apply(t, data) {
    if (data.name !== undefined) t.name = String(data.name);
    if (data.markdown_content !== undefined) t.markdown = String(data.markdown_content ?? '');
    else if (data.description !== undefined) t.markdown = String(data.description ?? '');
    if (data.status !== undefined) {
      const s = statuses.find((x) => x.status.toLowerCase() === String(data.status).toLowerCase());
      if (!s) return `Status not found`;
      t.status = s.status;
    }
    if (data.priority !== undefined) {
      if (data.priority !== null && !(data.priority >= 1 && data.priority <= 4)) return 'Priority invalid';
      t.priority = data.priority;
    }
    for (const k of ['due_date', 'start_date']) if (data[k] !== undefined) t[k] = data[k] === null ? null : String(data[k]);
    if (data.points !== undefined) t.points = data.points;
    if (data.parent !== undefined) t.parent = data.parent;
    if (data.assignees !== undefined) {
      const a = Array.isArray(data.assignees) ? { add: data.assignees, rem: [] } : data.assignees;
      for (const id of a.add ?? []) if (!userOf(id)) return `Assignee ${id} not found`;
      t.assignees = [...t.assignees.filter((x) => !(a.rem ?? []).map(String).includes(String(x))), ...(a.add ?? []).filter((x) => !t.assignees.map(String).includes(String(x)))];
    }
    return null;
  }

  const sign = (secret, body) => createHmac('sha256', secret).update(body).digest('hex');

  /** Delivers an event about task `t` to every webhook on its List (like ClickUp, in the background). */
  async function deliver(t, event = 'taskUpdated') {
    const out = [];
    for (const w of webhooks.filter((x) => !x.list_id || x.list_id === t.list)) {
      const body = JSON.stringify({ event, task_id: t.id, webhook_id: w.id, history_items: [{ id: randomBytes(4).toString('hex'), type: 1, date: String(Date.now()), user: { id: me.id } }] });
      const r = await fetch(w.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': sign(w.secret, body) }, body }).catch(() => ({ status: 0 }));
      deliveries.push({ webhook: w.id, task: t.id, status: r.status });
      out.push(r.status);
    }
    return out;
  }

  /** People editing in ClickUp. Delivered to the webhooks; resolves with their statuses. */
  async function edit(id, changes) {
    const t = tasks.get(id);
    if (!t) throw new Error(`no task ${id}`);
    if (changes.name !== undefined) t.name = changes.name;
    if (changes.markdown !== undefined) t.markdown = changes.markdown;
    if (changes.status !== undefined) t.status = changes.status;
    if (changes.priority !== undefined) t.priority = PRIORITY.indexOf(changes.priority);
    if (changes.due !== undefined) t.due_date = changes.due ? String(Date.parse(`${changes.due}T00:00:00Z`)) : null;
    if (changes.team !== undefined) t.team = teamField.type_config.options.find((o) => o.name === changes.team)?.id ?? null;
    if (changes.assignee !== undefined) t.assignees = changes.assignee ? [users.find((u) => u.email === changes.assignee).id] : [];
    touch(t);
    return deliver(t);
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const raw = await readBody(req);
    requests.push({ method: req.method, path: u.pathname, query: u.search, body: raw });
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    const fail = (status, err, ECODE = 'MOCK_000') => json(status, { err, ECODE });

    // ---- OAuth ----
    if (u.pathname === '/api' && req.method === 'GET') {
      const code = randomBytes(8).toString('hex');
      oauth.codes.add(code);
      res.writeHead(302, { location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(u.searchParams.get('state') ?? '')}` });
      return res.end();
    }
    if (u.pathname === '/api/v2/oauth/token' && req.method === 'POST') {
      const q = u.searchParams;
      if (q.get('client_id') !== oauth.clientId || q.get('client_secret') !== oauth.clientSecret) return fail(401, 'Client not found', 'OAUTH_010');
      if (!oauth.codes.delete(q.get('code'))) return fail(400, 'Code already used', 'OAUTH_015');
      const access = `${me.id}_${randomBytes(12).toString('hex')}`;
      oauth.tokens.add(access);
      return json(200, { access_token: access });
    }

    if (!u.pathname.startsWith('/api/v2/')) return fail(404, 'Route not found');
    if (!oauth.tokens.has(req.headers.authorization ?? '')) return fail(401, 'Token invalid', 'OAUTH_017');
    const path = u.pathname.slice('/api/v2'.length);
    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return fail(400, 'Invalid JSON');
      }
    }
    const page = (all) => {
      const p = Number(u.searchParams.get('page') ?? 0);
      const slice = all.slice(p * 100, p * 100 + 100);
      return { tasks: slice, last_page: (p + 1) * 100 >= all.length };
    };
    let m;

    if (path === '/user') return json(200, { user: { ...me } });
    if (path === '/team') return json(200, { teams: [{ id: team.id, name: team.name, members: users.map((x) => ({ user: { ...x } })) }] });
    if ((m = /^\/team\/(\d+)\/space$/.exec(path))) return json(200, { spaces: m[1] === team.id ? [{ id: space.id, name: space.name }] : [] });
    if ((m = /^\/space\/(\d+)\/folder$/.exec(path))) return json(200, { folders: m[1] === space.id ? [{ id: folder.id, name: folder.name, lists: lists.filter((l) => l.folder === folder).map((l) => ({ id: l.id, name: l.name })) }] : [] });
    if ((m = /^\/space\/(\d+)\/list$/.exec(path))) return json(200, { lists: m[1] === space.id ? lists.filter((l) => l.folder !== folder).map((l) => ({ id: l.id, name: l.name })) : [] });
    if ((m = /^\/space\/(\d+)\/tag$/.exec(path))) {
      if (req.method === 'GET') return json(200, { tags: space.tags.map((name) => ({ name })) });
      if (req.method === 'POST') {
        space.tags.push(String(body.tag?.name));
        return json(200, {});
      }
    }
    if ((m = /^\/team\/(\d+)\/field$/.exec(path))) return json(200, { fields: [{ id: teamField.id, name: teamField.name, type: teamField.type, type_config: teamField.type_config }] });
    if ((m = /^\/team\/(\d+)\/task$/.exec(path))) {
      const since = Number(u.searchParams.get('date_updated_gt') ?? 0);
      return json(200, page([...tasks.values()].filter((t) => Number(t.date_updated) > since).map(view)));
    }
    if ((m = /^\/team\/(\d+)\/webhook$/.exec(path)) && req.method === 'POST') {
      if (body.list_id && !listOf(String(body.list_id))) return fail(400, 'List not found');
      const w = { id: `wh-${randomBytes(6).toString('hex')}`, endpoint: body.endpoint, events: body.events, list_id: body.list_id ? String(body.list_id) : null, secret: randomBytes(16).toString('hex').toUpperCase() };
      webhooks.push(w);
      return json(200, { id: w.id, webhook: { id: w.id, userid: me.id, team_id: Number(team.id), endpoint: w.endpoint, events: w.events, list_id: w.list_id, secret: w.secret, health: { status: 'active', fail_count: 0 } } });
    }
    if ((m = /^\/webhook\/([\w-]+)$/.exec(path)) && req.method === 'DELETE') {
      const i = webhooks.findIndex((w) => w.id === m[1]);
      if (i < 0) return fail(404, 'Webhook not found');
      webhooks.splice(i, 1);
      return json(200, {});
    }
    if ((m = /^\/list\/(\d+)$/.exec(path))) {
      const l = listOf(m[1]);
      return l ? json(200, { id: l.id, name: l.name, statuses: l.statuses }) : fail(404, 'List not found', 'ITEM_013');
    }
    if ((m = /^\/list\/(\d+)\/member$/.exec(path))) return listOf(m[1]) ? json(200, { members: users.map((x) => ({ ...x })) }) : fail(404, 'List not found');
    if ((m = /^\/list\/(\d+)\/task$/.exec(path))) {
      const l = listOf(m[1]);
      if (!l) return fail(404, 'List not found', 'ITEM_013');
      if (req.method === 'GET') return json(200, page([...tasks.values()].filter((t) => t.list === l.id).map(view)));
      if (req.method === 'POST') {
        if (body.parent && !tasks.get(body.parent)) return fail(400, 'Parent not found');
        const t = create(l.id);
        const err = apply(t, body);
        if (err) {
          tasks.delete(t.id);
          return fail(400, err);
        }
        return json(200, view(t));
      }
    }
    if ((m = /^\/task\/(\w+)\/tag\/(.+)$/.exec(path))) {
      const t = tasks.get(m[1]);
      if (!t) return fail(404, 'Task not found', 'ITEM_015');
      const name = decodeURIComponent(m[2]);
      if (req.method === 'POST') {
        if (!space.tags.some((x) => x.toLowerCase() === name.toLowerCase())) return fail(400, 'Tag not found');
        if (!t.tags.includes(name)) t.tags.push(name);
      } else t.tags = t.tags.filter((x) => x !== name);
      touch(t);
      return json(200, {});
    }
    if ((m = /^\/task\/(\w+)\/field\/([\w-]+)$/.exec(path))) {
      const t = tasks.get(m[1]);
      if (!t) return fail(404, 'Task not found', 'ITEM_015');
      if (m[2] !== teamField.id) return fail(400, 'Custom field not found');
      if (req.method === 'POST') {
        if (!teamField.type_config.options.some((o) => o.id === body.value)) return fail(400, 'Value is not a valid option');
        t.team = body.value;
      } else t.team = null;
      touch(t);
      return json(200, {});
    }
    if ((m = /^\/task\/(\w+)\/dependency$/.exec(path))) {
      const t = tasks.get(m[1]);
      if (!t) return fail(404, 'Task not found', 'ITEM_015');
      const on = req.method === 'POST' ? body.depends_on : u.searchParams.get('depends_on');
      if (!tasks.get(on)) return fail(400, 'Dependency task not found');
      if (req.method === 'POST' && !t.dependsOn.includes(on)) t.dependsOn.push(on);
      if (req.method === 'DELETE') t.dependsOn = t.dependsOn.filter((x) => x !== on);
      touch(t);
      return json(200, {});
    }
    if ((m = /^\/task\/(\w+)\/comment$/.exec(path))) {
      const t = tasks.get(m[1]);
      if (!t) return fail(404, 'Task not found', 'ITEM_015');
      if (req.method === 'GET') return json(200, { comments: comments.filter((c) => c.task === t.id).map(({ task: _t, ...c }) => c) });
      const c = { id: nid(), comment_text: String(body.comment_text ?? ''), user: { id: me.id }, task: t.id };
      comments.push(c);
      return json(200, { id: c.id });
    }
    if ((m = /^\/comment\/(\d+)$/.exec(path))) {
      const i = comments.findIndex((c) => c.id === m[1]);
      if (i < 0) return fail(404, 'Comment not found');
      if (req.method === 'PUT') comments[i].comment_text = String(body.comment_text ?? '');
      else comments.splice(i, 1);
      return json(200, {});
    }
    if ((m = /^\/task\/(\w+)$/.exec(path))) {
      const t = tasks.get(m[1]);
      if (!t) return fail(404, 'Task not found', 'ITEM_015');
      if (req.method === 'GET') {
        const v = view(t);
        if (u.searchParams.get('include_subtasks') === 'true') v.subtasks = [...tasks.values()].filter((x) => x.parent === t.id).map((x) => ({ id: x.id, name: x.name }));
        return json(200, v);
      }
      if (req.method === 'PUT') {
        // Someone else's edit lands between Freero's read and this write.
        const i = pendingEdits.findIndex((p) => p.id === t.id);
        if (i >= 0) await edit(t.id, pendingEdits.splice(i, 1)[0].changes);
        const copy = structuredClone(t);
        const err = apply(copy, body);
        if (err) return fail(400, err);
        Object.assign(t, copy);
        touch(t);
        return json(200, view(t));
      }
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
    team,
    list: lists[0].id,
    lists,
    teamField,
    oauth: { clientId: oauth.clientId, clientSecret: oauth.clientSecret },
    requests,
    webhooks,
    deliveries,
    addUser: (email, username) => users.push({ id: 81000 + users.length + 1, username, email }),
    create: (listId, fields) => view(create(listId ?? lists[0].id, fields)),
    task: (id) => {
      const t = tasks.get(id);
      if (!t) return null;
      const v = view(t);
      return { ...v, statusName: t.status, team: teamField.type_config.options.find((o) => o.id === t.team)?.name ?? null, tagNames: t.tags, dependsOn: [...t.dependsOn], comments: comments.filter((c) => c.task === t.id) };
    },
    edit,
    editBeforeNextWrite: (id, changes) => pendingEdits.push({ id, changes }),
    /** People in ClickUp: task `id` now waits on `on` (`on` blocks it). Delivered for both. */
    async depend(id, on) {
      tasks.get(id).dependsOn.push(on);
      touch(tasks.get(id));
      touch(tasks.get(on));
      return [...(await deliver(tasks.get(id))), ...(await deliver(tasks.get(on)))];
    },
    async undepend(id, on) {
      tasks.get(id).dependsOn = tasks.get(id).dependsOn.filter((x) => x !== on);
      touch(tasks.get(id));
      touch(tasks.get(on));
      return [...(await deliver(tasks.get(id))), ...(await deliver(tasks.get(on)))];
    },
    /** A delivery about `id` signed with a secret that isn't the webhook's. */
    async forge(target, id) {
      const body = JSON.stringify({ event: 'taskUpdated', task_id: id, webhook_id: 'wh-x' });
      const r = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': sign('not-the-secret', body) }, body });
      return r.status;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--port');
  const c = await startMockClickUp({ port: Number(i >= 0 ? process.argv[i + 1] : 4487) });
  c.addUser('demo@freero.app', 'Demo User');
  c.create(c.list, { name: 'Pricing page' });
  c.create(c.list, { name: 'Checkout copy', status: 'in progress' });
  console.log(`mock ClickUp at ${c.url} (personal token ${c.token}; List Sprint board ${c.list})`);
}
