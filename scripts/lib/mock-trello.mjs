// Test-only Trello: the subset of Trello's REST API (https://api.trello.com/1) Freero's tracker sync
// uses (#181), in memory, for `npm run verify` and the UI by hand. Never a real board.
//
//   API    http://127.0.0.1:<port>/1/…  with `Authorization: OAuth oauth_consumer_key="<key>",
//          oauth_token="<token>"` (the key below, and a token made for it)
//   Authorize  /1/authorize?key=…&response_type=token (answers with a token, as Trello's page would
//          show one to paste)
//
// Board "Launch" has lists To Do, Doing and Done and a drop-down custom field "Team" (Web /
// Mobile); members' addresses are hidden (only the token's own member sees theirs), like Trello.
//
// Webhooks behave like Trello's: POST /webhooks first sends a HEAD request to the callback URL and
// makes the webhook only if it answers 200; every change people make to a card of the board is then
// delivered there, signed (X-Trello-Webhook: base64 HMAC-SHA1 of body + callback URL with the API
// key's secret). Checks drive it like people in Trello would: `edit(id, changes)` (delivered),
// `editBeforeNextWrite(id, changes)` (someone edits between Freero's read and its write),
// `forge(target, id)` (a delivery signed with another secret).
//
//   node scripts/lib/mock-trello.mjs --port 4488

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

export async function startMockTrello({ port = 0, host = '127.0.0.1', key = 'trello-api-key-0123456789abcdef', secret = 'trello-api-secret-fedcba9876543210', token = 'ATTA-trello-token' } = {}) {
  const requests = [];
  let seq = 0;
  const oid = () => `${Date.now().toString(16).slice(-8)}${(++seq).toString(16).padStart(16, '0')}`;
  const members = [{ id: oid(), username: 'freerobot', fullName: 'Freero bot', email: 'bot@trello.test' }];
  const me = members[0];
  const board = { id: oid(), name: 'Launch', members: [me.id], labels: [], idShort: 0 };
  const lists = ['To Do', 'Doing', 'Done'].map((name) => ({ id: oid(), name, idBoard: board.id }));
  const teamField = { id: oid(), idModel: board.id, name: 'Team', type: 'list', options: [{ id: oid(), value: { text: 'Web' } }, { id: oid(), value: { text: 'Mobile' } }] };
  const cards = new Map();
  const attachments = [];
  const webhooks = [];
  const deliveries = [];
  const pendingEdits = [];
  /** Each token acts as one member (`/members/me`). */
  const tokens = new Map([[token, null]]);
  let url = '';

  const touch = (c) => (c.dateLastActivity = new Date().toISOString());
  const listOf = (id) => lists.find((l) => l.id === id);
  const memberOf = (id) => members.find((m) => m.id === id);

  function view(c, full = true) {
    const out = {
      id: c.id,
      idShort: c.idShort,
      name: c.name,
      desc: c.desc,
      closed: false,
      idList: c.idList,
      idBoard: board.id,
      idMembers: [...c.idMembers],
      start: c.start,
      due: c.due,
      labels: c.idLabels.map((id) => board.labels.find((l) => l.id === id)),
      dateLastActivity: c.dateLastActivity,
      shortUrl: `https://trello.com/c/${c.shortLink}`,
      url: `https://trello.com/c/${c.shortLink}/${c.idShort}-card`,
      customFieldItems: c.team ? [{ id: oid(), idCustomField: teamField.id, idValue: c.team, idModel: c.id, modelType: 'card' }] : [],
    };
    if (full) {
      // Other members' addresses are never shown.
      out.members = c.idMembers.map((id) => ({ id, username: memberOf(id).username, fullName: memberOf(id).fullName }));
      out.list = { id: c.idList, name: listOf(c.idList).name };
      out.board = { id: board.id, name: board.name };
    }
    return out;
  }

  function create(fields = {}) {
    const c = { id: oid(), idShort: ++board.idShort, shortLink: randomBytes(4).toString('hex'), name: 'Untitled', desc: '', idList: lists[0].id, idMembers: [], idLabels: [], start: null, due: null, team: null, dateLastActivity: '' };
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'list') c.idList = lists.find((l) => l.name === v).id;
      else c[k] = v;
    }
    touch(c);
    cards.set(c.id, c);
    return c;
  }

  const sign = (s, body, callback) => createHmac('sha1', s).update(body + callback).digest('base64');

  async function deliver(c, type = 'updateCard') {
    const out = [];
    for (const w of webhooks.filter((x) => x.active && x.idModel === board.id)) {
      const body = JSON.stringify({ action: { id: oid(), type, date: new Date().toISOString(), data: { card: { id: c.id, name: c.name, idShort: c.idShort, shortLink: c.shortLink }, board: { id: board.id, name: board.name } }, idMemberCreator: me.id }, model: { id: board.id, name: board.name } });
      const r = await fetch(w.callbackURL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-trello-webhook': sign(secret, body, w.callbackURL) }, body }).catch(() => ({ status: 0 }));
      deliveries.push({ webhook: w.id, card: c.id, status: r.status });
      out.push(r.status);
    }
    return out;
  }

  /** People editing in Trello. Delivered to the webhooks; resolves with their statuses. */
  async function edit(id, changes) {
    const c = cards.get(id);
    if (!c) throw new Error(`no card ${id}`);
    if (changes.name !== undefined) c.name = changes.name;
    if (changes.desc !== undefined) c.desc = changes.desc;
    if (changes.list !== undefined) c.idList = lists.find((l) => l.name === changes.list).id;
    if (changes.due !== undefined) c.due = changes.due ? `${changes.due}T17:00:00.000Z` : null;
    if (changes.team !== undefined) c.team = teamField.options.find((o) => o.value.text === changes.team)?.id ?? null;
    if (changes.member !== undefined) c.idMembers = changes.member ? [members.find((m) => m.username === changes.member).id] : [];
    touch(c);
    return deliver(c);
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const raw = await readBody(req);
    requests.push({ method: req.method, path: u.pathname, query: u.search, body: raw });
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    const text = (status, t) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(t);
    };

    if (u.pathname === '/1/authorize') {
      if (u.searchParams.get('key') !== key) return text(401, 'invalid key');
      const t = `ATTA-${randomBytes(12).toString('hex')}`;
      tokens.set(t, null);
      return text(200, t);
    }
    if (!u.pathname.startsWith('/1/')) return text(404, 'Cannot find');
    const auth = /^OAuth oauth_consumer_key="([^"]*)", oauth_token="([^"]*)"$/.exec(req.headers.authorization ?? '');
    if (!auth || auth[1] !== key) return text(401, 'invalid key');
    if (!tokens.has(auth[2])) return text(401, 'invalid token');
    const path = u.pathname.slice(2);
    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return text(400, 'invalid json');
      }
    }
    const q = Object.fromEntries(u.searchParams);
    const data = { ...q, ...body };
    let m;

    const self = memberOf(tokens.get(auth[2])) ?? me;
    if (path === '/members/me') return json(200, { id: self.id, username: self.username, fullName: self.fullName, email: self.email });
    if (path === '/members/me/boards') return json(200, [{ id: board.id, name: board.name }]);
    if (path === '/batch') {
      const urls = String(q.urls ?? '').split(',').slice(0, 10);
      return json(
        200,
        urls.map((x) => {
          const c = cards.get(/^\/cards\/([0-9a-f]{24})/.exec(decodeURIComponent(x))?.[1]);
          return c ? { 200: { id: c.id, dateLastActivity: c.dateLastActivity } } : { 404: 'card not found' };
        }),
      );
    }
    if ((m = /^\/boards\/([0-9a-f]{24})\/(lists|labels|members|customFields|cards\/open|cards)$/.exec(path))) {
      if (m[1] !== board.id) return text(404, 'board not found');
      if (m[2] === 'lists') return json(200, lists.map((l) => ({ id: l.id, name: l.name })));
      if (m[2] === 'labels') return json(200, board.labels);
      if (m[2] === 'members') return json(200, board.members.map((id) => ({ id, username: memberOf(id).username, fullName: memberOf(id).fullName })));
      if (m[2] === 'customFields') return json(200, [teamField]);
      return json(200, [...cards.values()].map((c) => view(c, false)));
    }
    if (path === '/labels' && req.method === 'POST') {
      if (data.idBoard !== board.id) return text(400, 'invalid idBoard');
      const l = { id: oid(), name: String(data.name ?? ''), color: data.color ?? null, idBoard: board.id };
      board.labels.push(l);
      return json(200, l);
    }
    if (path === '/cards' && req.method === 'POST') {
      if (!listOf(data.idList)) return text(400, 'invalid value for idList');
      const c = create({ name: String(data.name ?? ''), desc: String(data.desc ?? ''), idList: data.idList });
      return json(200, view(c));
    }
    if ((m = /^\/cards\/([0-9a-f]{24})\/idMembers(?:\/([0-9a-f]{24}))?$/.exec(path))) {
      const c = cards.get(m[1]);
      if (!c) return text(404, 'card not found');
      if (req.method === 'POST') {
        if (!board.members.includes(data.value)) return text(400, 'member not on the board');
        if (!c.idMembers.includes(data.value)) c.idMembers.push(data.value);
      } else c.idMembers = c.idMembers.filter((x) => x !== m[2]);
      touch(c);
      return json(200, c.idMembers);
    }
    if ((m = /^\/cards\/([0-9a-f]{24})\/idLabels(?:\/([0-9a-f]{24}))?$/.exec(path))) {
      const c = cards.get(m[1]);
      if (!c) return text(404, 'card not found');
      if (req.method === 'POST') {
        if (!board.labels.some((l) => l.id === data.value)) return text(400, 'invalid label');
        if (!c.idLabels.includes(data.value)) c.idLabels.push(data.value);
      } else c.idLabels = c.idLabels.filter((x) => x !== m[2]);
      touch(c);
      return json(200, c.idLabels);
    }
    if ((m = /^\/cards\/([0-9a-f]{24})\/customField\/([0-9a-f]{24})\/item$/.exec(path)) && req.method === 'PUT') {
      const c = cards.get(m[1]);
      if (!c) return text(404, 'card not found');
      if (m[2] !== teamField.id) return text(400, 'invalid custom field');
      if (data.idValue === '') c.team = null;
      else if (teamField.options.some((o) => o.id === data.idValue)) c.team = data.idValue;
      else return text(400, 'invalid idValue');
      touch(c);
      return json(200, {});
    }
    if ((m = /^\/cards\/([0-9a-f]{24})\/attachments(?:\/([0-9a-f]{24}))?$/.exec(path))) {
      const c = cards.get(m[1]);
      if (!c) return text(404, 'card not found');
      if (req.method === 'GET') return json(200, attachments.filter((a) => a.card === c.id).map(({ card: _c, ...a }) => a));
      if (req.method === 'POST') {
        if (!/^https?:\/\//.test(data.url ?? '')) return text(400, 'invalid url');
        const a = { id: oid(), url: data.url, name: String(data.name ?? ''), card: c.id };
        attachments.push(a);
        return json(200, { id: a.id, url: a.url, name: a.name });
      }
      const i = attachments.findIndex((a) => a.id === m[2]);
      if (i < 0) return text(404, 'attachment not found');
      attachments.splice(i, 1);
      return json(200, {});
    }
    if ((m = /^\/cards\/([0-9a-f]{24})$/.exec(path))) {
      const c = cards.get(m[1]);
      if (!c) return text(404, 'The requested resource was not found.');
      if (req.method === 'GET') return json(200, view(c));
      if (req.method === 'PUT') {
        const i = pendingEdits.findIndex((p) => p.id === c.id);
        if (i >= 0) await edit(c.id, pendingEdits.splice(i, 1)[0].changes);
        if (data.idList !== undefined && !listOf(data.idList)) return text(400, 'invalid value for idList');
        for (const k of ['name', 'desc', 'idList', 'start', 'due']) if (data[k] !== undefined) c[k] = data[k];
        touch(c);
        return json(200, view(c));
      }
    }
    if (path === '/webhooks' && req.method === 'POST') {
      if (data.idModel !== board.id) return text(400, 'invalid value for idModel');
      // Trello checks the callback first: a HEAD request that must answer 200.
      const head = await fetch(data.callbackURL, { method: 'HEAD' }).catch(() => null);
      if (!head || head.status !== 200) return text(400, `URL (${data.callbackURL}) did not return 200 status code, got ${head?.status ?? 'nothing'}`);
      const w = { id: oid(), callbackURL: data.callbackURL, idModel: data.idModel, description: data.description ?? '', active: true };
      webhooks.push(w);
      return json(200, w);
    }
    if ((m = /^\/webhooks\/([0-9a-f]{24})$/.exec(path)) && req.method === 'DELETE') {
      const i = webhooks.findIndex((w) => w.id === m[1]);
      if (i < 0) return text(404, 'webhook not found');
      webhooks.splice(i, 1);
      return json(200, {});
    }
    return text(404, `mock: no route ${req.method} ${path}`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  url = `http://${host}:${server.address().port}`;
  return {
    url,
    site: url,
    key,
    secret,
    token,
    board: board.id,
    lists,
    teamField,
    requests,
    webhooks,
    deliveries,
    /** A Trello member with a token of their own (their address shows only to themselves). */
    addMember(username, email) {
      const mm = { id: oid(), username, fullName: username, email };
      members.push(mm);
      board.members.push(mm.id);
      const t = `ATTA-${username}-${randomBytes(6).toString('hex')}`;
      tokens.set(t, mm.id);
      return { id: mm.id, token: t };
    },
    create: (fields) => view(create(fields)),
    /** The id of the card at a Trello address (…/c/<shortLink>). */
    cardIdOf: (address) => [...cards.values()].find((c) => String(address).includes(`/c/${c.shortLink}`))?.id ?? null,
    card: (id) => {
      const c = cards.get(id);
      if (!c) return null;
      return { ...view(c), listName: listOf(c.idList).name, memberNames: c.idMembers.map((x) => memberOf(x).username), labelNames: c.idLabels.map((x) => board.labels.find((l) => l.id === x).name), team: teamField.options.find((o) => o.id === c.team)?.value.text ?? null, attachments: attachments.filter((a) => a.card === c.id) };
    },
    edit,
    editBeforeNextWrite: (id, changes) => pendingEdits.push({ id, changes }),
    /** A delivery about `id` signed with a secret that isn't the key's. */
    async forge(target, id) {
      const body = JSON.stringify({ action: { type: 'updateCard', data: { card: { id } } } });
      const r = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', 'x-trello-webhook': sign('not-the-secret', body, target) }, body });
      return r.status;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--port');
  const t = await startMockTrello({ port: Number(i >= 0 ? process.argv[i + 1] : 4488) });
  t.create({ name: 'Pricing page' });
  t.create({ name: 'Launch copy', list: 'Doing' });
  console.log(`mock Trello at ${t.url} (API key ${t.key}, secret ${t.secret}, token ${t.token}; board Launch ${t.board})`);
}
