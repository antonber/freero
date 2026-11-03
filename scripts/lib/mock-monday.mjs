// Test-only monday.com: the subset of monday.com's GraphQL API (POST /v2) Freero's tracker sync
// uses (#121), in memory, for `npm run verify` and the UI by hand. Never a real account. Queries
// are recognised by the fields Freero asks for (like mock-linear.mjs); values come as variables.
//
// Board "Roadmap" has groups This week / Next week and columns Status (Working on it, Done — the
// done label —, Stuck, blank), Owner (people), Due (date), Timeline, Priority (a status column
// Freero leaves alone) and Team (a status column with Web / Mobile, for the field map). Board
// "Inbox" has no Status column: its groups To do / Doing / Done are where an item stands.
// Subitems live on their own board, like monday.com's.
//
// Webhooks behave like monday.com's: create_webhook first posts { challenge } to the address and
// creates the webhook only if the answer echoes it; then changes on the board are posted there
// (unsigned, as for webhooks made with an API token). Checks drive it like people would:
// `edit(id, changes)` (delivered), `editBeforeNextWrite(id, changes)`, `exhaustComplexity(s)`
// (the next call finds the complexity budget spent), `challengeAgain(url)`.
//
//   node scripts/lib/mock-monday.mjs --port 4486

import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export async function startMockMonday({ port = 0, host = '127.0.0.1', token = 'monday-api-token' } = {}) {
  const requests = [];
  let seq = 7000000000;
  const nextId = () => String(++seq);
  const me = { id: '9001', name: 'Freero bot', email: 'bot@monday.test' };
  const users = [me];
  const status = (id, title, labels, done = []) => ({ id, title, type: 'status', settings_str: JSON.stringify({ labels, done_colors: done }) });
  const boards = [
    {
      id: '5000000001',
      name: 'Roadmap',
      type: 'board',
      columns: [
        { id: 'name', title: 'Name', type: 'name', settings_str: '{}' },
        status('status', 'Status', { 0: 'Working on it', 1: 'Done', 2: 'Stuck', 5: '' }, [1]),
        { id: 'person', title: 'Owner', type: 'people', settings_str: '{}' },
        { id: 'date4', title: 'Due', type: 'date', settings_str: '{}' },
        { id: 'timeline', title: 'Timeline', type: 'timeline', settings_str: '{}' },
        status('priority', 'Priority', { 0: 'High', 1: 'Medium', 2: 'Low' }),
        status('team', 'Team', { 0: 'Web', 1: 'Mobile' }),
      ],
      groups: [
        { id: 'topics', title: 'This week' },
        { id: 'group_2', title: 'Next week' },
      ],
    },
    {
      id: '5000000002',
      name: 'Inbox',
      type: 'board',
      columns: [{ id: 'name', title: 'Name', type: 'name', settings_str: '{}' }, { id: 'person', title: 'Person', type: 'people', settings_str: '{}' }],
      groups: [
        { id: 'todo', title: 'To do' },
        { id: 'doing', title: 'Doing' },
        { id: 'done', title: 'Done' },
      ],
    },
    { id: '5000000099', name: 'Subitems of Roadmap', type: 'sub_items_board', columns: [{ id: 'name', title: 'Name', type: 'name', settings_str: '{}' }, { id: 'person', title: 'Owner', type: 'people', settings_str: '{}' }], groups: [{ id: 'topics', title: 'Subitems' }] },
  ];
  const items = new Map();
  const webhooks = [];
  const deliveries = [];
  const pendingEdits = [];
  let complexityWait = 0;
  const oauth = { clientId: 'monday-client', clientSecret: 'monday-client-secret', codes: new Set(), tokens: new Set([token]) };
  let url = '';

  const boardOf = (id) => boards.find((b) => b.id === String(id));
  const touch = (i) => (i.updated_at = new Date().toISOString());
  const labelsOf = (col) => JSON.parse(col.settings_str).labels ?? {};

  function columnValue(i, col) {
    const v = i.columns[col.id];
    if (v === undefined || v === null) return { id: col.id, type: col.type, text: col.type === 'status' ? '' : null, value: null };
    switch (col.type) {
      case 'status':
        return { id: col.id, type: col.type, text: labelsOf(col)[v.index] ?? '', value: JSON.stringify({ index: v.index, post_id: null }) };
      case 'people':
        return { id: col.id, type: col.type, text: v.personsAndTeams.map((p) => users.find((u) => u.id === String(p.id))?.name ?? '').join(', '), value: JSON.stringify(v) };
      case 'date':
        return { id: col.id, type: col.type, text: v.date, value: JSON.stringify(v) };
      case 'timeline':
        return { id: col.id, type: col.type, text: `${v.from} - ${v.to}`, value: JSON.stringify(v) };
      default:
        return { id: col.id, type: col.type, text: String(v), value: JSON.stringify(v) };
    }
  }

  function view(i) {
    const b = boardOf(i.board);
    return {
      id: i.id,
      name: i.name,
      state: i.state,
      updated_at: i.updated_at,
      board: { id: b.id, name: b.name, type: b.type, columns: b.columns, groups: b.groups },
      group: b.groups.find((g) => g.id === i.group) ?? null,
      parent_item: i.parent ? { id: i.parent, name: items.get(i.parent)?.name } : null,
      column_values: b.columns.filter((c) => c.id !== 'name').map((c) => columnValue(i, c)),
      updates: [...i.updates].reverse(),
      subitems: [...items.values()].filter((x) => x.parent === i.id && x.state === 'active').map(view),
    };
  }

  function create(boardId, name, fields = {}) {
    const b = boardOf(boardId);
    const i = { id: nextId(), name, board: b.id, group: b.groups[0].id, parent: null, columns: {}, updates: [], state: 'active', updated_at: '' };
    Object.assign(i, fields);
    touch(i);
    items.set(i.id, i);
    return i;
  }

  /** change_multiple_column_values, monday.com's way: an error message or null. */
  function apply(i, values) {
    const b = boardOf(i.board);
    for (const [key, v] of Object.entries(values)) {
      if (key === 'name') {
        i.name = String(v);
        continue;
      }
      const col = b.columns.find((c) => c.id === key);
      if (!col) return `This column ID doesn't exist for the board: ${key}`;
      if (v === '' || v === null || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) {
        delete i.columns[key];
        continue;
      }
      if (col.type === 'status') {
        const entry = Object.entries(labelsOf(col)).find(([, l]) => l === v.label);
        if (!entry) return `This status label doesn't exist, possible statuses are: ${Object.values(labelsOf(col)).join(', ')}`;
        i.columns[key] = { index: Number(entry[0]) };
      } else if (col.type === 'people') {
        if (!Array.isArray(v.personsAndTeams)) return 'invalid value for people column';
        i.columns[key] = { personsAndTeams: v.personsAndTeams.map((p) => ({ id: Number(p.id), kind: p.kind ?? 'person' })) };
        if (!v.personsAndTeams.length) delete i.columns[key];
      } else if (col.type === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date ?? '')) return 'invalid value for date column';
        i.columns[key] = { date: v.date };
      } else if (col.type === 'timeline') {
        if (!v.from || !v.to) return 'invalid value for timeline column';
        i.columns[key] = { from: v.from, to: v.to };
      } else i.columns[key] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    return null;
  }

  async function deliver(i, type, extra = {}) {
    const out = [];
    for (const w of webhooks.filter((x) => x.board === i.board && x.event === type)) {
      const body = JSON.stringify({ event: { app: 'monday', type: `update_${type}`, triggerTime: new Date().toISOString(), subscriptionId: Number(w.id), userId: Number(me.id), originalTriggerUuid: null, boardId: Number(i.board), pulseId: Number(i.id), triggerUuid: randomBytes(8).toString('hex'), ...extra } });
      const r = await fetch(w.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => ({ status: 0 }));
      deliveries.push({ webhook: w.id, item: i.id, type, status: r.status });
      out.push(r.status);
    }
    return out;
  }

  /** People editing in monday.com; delivered to the board's webhooks (resolves with their statuses). */
  async function edit(id, changes) {
    const i = items.get(String(id));
    if (!i) throw new Error(`no item ${id}`);
    const b = boardOf(i.board);
    const out = [];
    if (changes.name !== undefined) {
      i.name = changes.name;
      touch(i);
      out.push(...(await deliver(i, 'change_name')));
    }
    if (changes.status !== undefined) {
      const entry = Object.entries(labelsOf(b.columns.find((c) => c.id === 'status'))).find(([, l]) => l === changes.status);
      i.columns.status = { index: Number(entry[0]) };
      touch(i);
      out.push(...(await deliver(i, 'change_column_value', { columnId: 'status' })));
    }
    if (changes.team !== undefined) {
      const entry = Object.entries(labelsOf(b.columns.find((c) => c.id === 'team'))).find(([, l]) => l === changes.team);
      i.columns.team = { index: Number(entry[0]) };
      touch(i);
      out.push(...(await deliver(i, 'change_column_value', { columnId: 'team' })));
    }
    if (changes.due !== undefined) {
      i.columns.date4 = { date: changes.due };
      touch(i);
      out.push(...(await deliver(i, 'change_column_value', { columnId: 'date4' })));
    }
    if (changes.group !== undefined) {
      i.group = b.groups.find((g) => g.title === changes.group).id;
      touch(i);
      out.push(...(await deliver(i, 'item_moved_to_any_group')));
    }
    if (changes.update !== undefined) {
      i.updates.push({ id: nextId(), body: `<p>${changes.update}</p>`, created_at: new Date().toISOString(), creator: { id: changes.by ?? '9100' } });
      touch(i);
      out.push(...(await deliver(i, 'create_update')));
    }
    return out;
  }

  function resolve(query, v) {
    if (complexityWait) {
      const s = complexityWait;
      complexityWait = 0;
      return { errors: [{ message: 'Complexity budget exhausted', extensions: { code: 'COMPLEXITY_BUDGET_EXHAUSTED', retry_in_seconds: s, complexity: 10000, complexity_budget_left: 0 } }], account_id: 1 };
    }
    let m;
    const fail = (message) => ({ errors: [{ message, locations: [], path: [] }] });
    if (/\bme\s*\{/.test(query)) return { data: { me: { id: me.id, name: me.name, email: me.email, account: { slug: 'acme' } } } };
    if (/boards \(limit: 200/.test(query)) return { data: { boards: boards.map((b) => ({ id: b.id, name: b.name, type: b.type, workspace: { name: 'Main workspace' } })) } };
    if (/boards \(limit: 50/.test(query)) return { data: { boards: boards.map((b) => ({ id: b.id, name: b.name, type: b.type, columns: b.columns.map(({ id, title, type }) => ({ id, title, type })) })) } };
    if (/boards \(ids: \$board\) \{ items_page/.test(query)) {
      const b = boardOf(v.board?.[0]);
      if (!b) return { data: { boards: [] } };
      const all = [...items.values()].filter((i) => i.board === b.id && i.state === 'active');
      const limit = v.limit ?? 25;
      return { data: { boards: [{ items_page: { cursor: all.length > limit ? `c:${b.id}:${limit}` : null, items: all.slice(0, limit).map(view) } }] } };
    }
    if (/next_items_page/.test(query)) {
      const [, boardId, at] = String(v.cursor).split(':');
      const all = [...items.values()].filter((i) => i.board === boardId && i.state === 'active');
      const from = Number(at);
      const limit = v.limit ?? 25;
      return { data: { next_items_page: { cursor: all.length > from + limit ? `c:${boardId}:${from + limit}` : null, items: all.slice(from, from + limit).map(view) } } };
    }
    if (/boards \(ids: \$board\)/.test(query)) {
      const b = boardOf(v.board?.[0]);
      return { data: { boards: b ? [{ id: b.id, name: b.name, type: b.type, columns: b.columns, groups: b.groups }] : [] } };
    }
    if (/items \(ids: \$ids\) \{ subitems/.test(query)) return { data: { items: (v.ids ?? []).map((id) => items.get(String(id))).filter(Boolean).map((i) => ({ subitems: view(i).subitems })) } };
    if (/items \(ids: \$ids\) \{ id updated_at \}/.test(query)) return { data: { items: (v.ids ?? []).map((id) => items.get(String(id))).filter(Boolean).map((i) => ({ id: i.id, updated_at: i.updated_at })) } };
    if (/items \(ids: \$ids\)/.test(query)) return { data: { items: (v.ids ?? []).map((id) => items.get(String(id))).filter(Boolean).map(view) } };
    if (/users \(ids:/.test(query)) return { data: { users: users.filter((u) => (v.ids ?? []).map(String).includes(u.id)) } };
    if (/users \(emails:/.test(query)) return { data: { users: users.filter((u) => (v.emails ?? []).some((e) => e.toLowerCase() === u.email.toLowerCase())).map(({ id, email }) => ({ id, email })) } };
    if (/create_item \(/.test(query)) {
      if (!boardOf(v.board)) return fail(`Board not found: ${v.board}`);
      return { data: { create_item: { id: create(v.board, v.name).id } } };
    }
    if (/create_subitem \(/.test(query)) {
      const parent = items.get(String(v.parent));
      if (!parent) return fail('Item not found');
      return { data: { create_subitem: { id: create('5000000099', v.name, { parent: parent.id }).id } } };
    }
    if (/change_multiple_column_values \(/.test(query)) {
      const i = items.get(String(v.item));
      if (!i || i.board !== String(v.board)) return fail('Item not found in board');
      // Someone else's edit lands between Freero's read and this write.
      const p = pendingEdits.findIndex((x) => x.id === i.id);
      const before = p >= 0 ? edit(i.id, pendingEdits.splice(p, 1)[0].changes) : null;
      return (async () => {
        await before;
        let values;
        try {
          values = JSON.parse(v.values);
        } catch {
          return fail('column_values: invalid JSON');
        }
        const copy = structuredClone(i);
        const err = apply(copy, values);
        if (err) return { error_code: 'ColumnValueException', status_code: 200, error_message: err, error_data: {} };
        Object.assign(i, copy);
        touch(i);
        return { data: { change_multiple_column_values: { id: i.id } } };
      })();
    }
    if (/move_item_to_group \(/.test(query)) {
      const i = items.get(String(v.item));
      const g = i && boardOf(i.board).groups.find((x) => x.id === v.group);
      if (!g) return fail('Group not found');
      i.group = g.id;
      touch(i);
      return { data: { move_item_to_group: { id: i.id } } };
    }
    if (/create_update \(/.test(query)) {
      const i = items.get(String(v.item));
      if (!i) return fail('Item not found');
      const u = { id: nextId(), body: v.body, created_at: new Date().toISOString(), creator: { id: me.id } };
      i.updates.push(u);
      touch(i);
      return { data: { create_update: { id: u.id } } };
    }
    if ((m = /(edit_update|delete_update) \(/.exec(query))) {
      for (const i of items.values()) {
        const k = i.updates.findIndex((u) => u.id === String(v.id));
        if (k < 0) continue;
        if (i.updates[k].creator.id !== me.id) return fail('User unauthorized to perform action: only the update’s creator can change it');
        if (m[1] === 'edit_update') i.updates[k].body = v.body;
        else i.updates.splice(k, 1);
        touch(i);
        return { data: { [m[1]]: { id: String(v.id) } } };
      }
      return fail('Update not found');
    }
    if (/create_webhook \(/.test(query)) {
      if (!boardOf(v.board)) return fail('Board not found');
      return (async () => {
        // The challenge, before answering: the address must echo it.
        const challenge = randomBytes(12).toString('hex');
        const r = await fetch(v.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge }) }).catch(() => null);
        const echoed = r && r.ok ? await r.json().catch(() => null) : null;
        if (echoed?.challenge !== challenge) return fail('Failed to communicate with URL provided.');
        const w = { id: nextId(), board: String(v.board), url: v.url, event: v.event };
        webhooks.push(w);
        return { data: { create_webhook: { id: w.id, board_id: w.board } } };
      })();
    }
    if (/delete_webhook \(/.test(query)) {
      const k = webhooks.findIndex((w) => w.id === String(v.id));
      if (k < 0) return fail('Webhook not found');
      webhooks.splice(k, 1);
      return { data: { delete_webhook: { id: String(v.id) } } };
    }
    return fail(`mock: unsupported query ${query.slice(0, 80)}`);
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const u = new URL(req.url, 'http://x');
      requests.push({ method: req.method, path: u.pathname, body: raw, version: req.headers['api-version'] ?? null });
      const json = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (u.pathname === '/oauth2/authorize') {
        const code = randomBytes(8).toString('hex');
        oauth.codes.add(code);
        res.writeHead(302, { location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(u.searchParams.get('state') ?? '')}` });
        return res.end();
      }
      if (u.pathname === '/oauth2/token' && req.method === 'POST') {
        const f = new URLSearchParams(raw);
        if (f.get('client_id') !== oauth.clientId || f.get('client_secret') !== oauth.clientSecret || !oauth.codes.delete(f.get('code'))) return json(400, { error: 'invalid_grant' });
        const access = `monday-oauth-${randomBytes(8).toString('hex')}`;
        oauth.tokens.add(access);
        return json(200, { access_token: access, token_type: 'bearer', scope: 'me:read boards:read boards:write' });
      }
      if (u.pathname !== '/v2' || req.method !== 'POST') return json(404, { errors: [{ message: 'not found' }] });
      if (!oauth.tokens.has(req.headers.authorization ?? '')) return json(401, { errors: [{ message: 'Not Authenticated', extensions: { code: 'UNAUTHENTICATED' } }] });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, { errors: [{ message: 'bad json' }] });
      }
      json(200, await resolve(String(body.query ?? ''), body.variables ?? {}));
    });
  });
  await new Promise((r, j) => {
    server.once('error', j);
    server.listen(port, host, r);
  });
  url = `http://${host}:${server.address().port}`;
  return {
    url,
    site: url,
    token,
    oauth: { clientId: oauth.clientId, clientSecret: oauth.clientSecret },
    board: boards[0].id,
    inbox: boards[1].id,
    requests,
    webhooks,
    deliveries,
    addUser: (email, name) => {
      const u = { id: nextId(), name, email };
      users.push(u);
      return u.id;
    },
    create: (boardId, name, fields) => view(create(boardId ?? boards[0].id, name, fields)),
    item: (id) => {
      const i = items.get(String(id));
      if (!i) return null;
      const v = view(i);
      const text = (col) => v.column_values.find((c) => c.id === col)?.text ?? null;
      return { ...v, status: text('status'), team: text('team'), due: i.columns.date4?.date ?? null, timeline: i.columns.timeline ?? null, owner: i.columns.person?.personsAndTeams?.[0]?.id ?? null, groupTitle: v.group?.title ?? null };
    },
    edit,
    /** The next column write to item `id` finds it changed by someone else first. */
    editBeforeNextWrite: (id, changes) => pendingEdits.push({ id: String(id), changes }),
    /** The next call finds the complexity budget spent, resetting in `seconds`. */
    exhaustComplexity: (seconds) => (complexityWait = seconds),
    /** A challenge posted again to an address already registered. */
    async challengeAgain(target) {
      const r = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge: 'their-own' }) });
      return r.status;
    },
    /** A delivery posted to `target` (with whatever key it carries) about item `id`. */
    async post(target, id) {
      const r = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: { type: 'update_column_value', boardId: Number(items.get(String(id))?.board ?? 0), pulseId: Number(id) } }) });
      return r.status;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--port');
  const m = await startMockMonday({ port: Number(i >= 0 ? process.argv[i + 1] : 4486) });
  m.addUser('demo@freero.app', 'Demo User');
  m.create(m.board, 'Pricing page');
  console.log(`mock monday.com at ${m.url} (API token ${m.token}; board Roadmap ${m.board}, Inbox ${m.inbox})`);
}
