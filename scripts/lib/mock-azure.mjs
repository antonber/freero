// Test-only Azure DevOps: the subset of the Azure DevOps REST API Freero's tracker sync uses (#6),
// in memory, for `npm run verify` and the UI by hand. Never a real organization.
//
//   Services  http://127.0.0.1:<port>/<organization>/…  (api-version 7.1)
//   Server    the same paths under a collection          (api-version 6.0)
// A personal access token as Basic with an empty user name, like Azure DevOps takes it.
//
// Project "Fabrikam" has iterations Sprint 1 (over), Sprint 2 (now) and Sprint 3 (next), work item
// types Task / Bug / User Story / Epic with the states New (Proposed), Active (InProgress),
// Resolved, Closed (Completed) and Removed, and a picklist field Custom.Team (Web / Mobile).
// Writes are JSON Patch; a `test` of /rev against an older revision is refused with 412, as Azure
// DevOps refuses a write over someone else's change.
//
// Checks drive it like people in Azure DevOps would: `edit(id, { title, state, iteration, team })`
// bumps the revision, `editBeforeNextPatch(id, changes)` makes someone edit the work item between
// Freero's read and its write, `editAfterNextPatch(id, changes)` right after it (before Freero
// reads it again), `webhook(url, secret, id)` posts a service hook delivery
// authenticated with basic auth (the secret as the password).
//
//   node scripts/lib/mock-azure.mjs --port 4484 [--deployment server]

import http from 'node:http';
import { pathToFileURL } from 'node:url';

const STATES = [
  { name: 'New', category: 'Proposed', color: 'b2b2b2' },
  { name: 'Active', category: 'InProgress', color: '007acc' },
  { name: 'Resolved', category: 'Resolved', color: 'ff9d00' },
  { name: 'Closed', category: 'Completed', color: '339933' },
  { name: 'Removed', category: 'Removed', color: 'ffffff' },
];
const TYPES = ['Task', 'Bug', 'User Story', 'Epic'];
const FIELDS = [
  ['System.Title', 'Title', 'string'],
  ['System.Description', 'Description', 'html'],
  ['System.Tags', 'Tags', 'plainText'],
  ['System.AssignedTo', 'Assigned To', 'identity'],
  ['System.State', 'State', 'string'],
  ['System.IterationPath', 'Iteration Path', 'treePath'],
  ['System.ChangedDate', 'Changed Date', 'dateTime', true],
  ['Microsoft.VSTS.Common.Priority', 'Priority', 'integer'],
  ['Microsoft.VSTS.Scheduling.StoryPoints', 'Story Points', 'double'],
  ['Microsoft.VSTS.Scheduling.StartDate', 'Start Date', 'dateTime'],
  ['Microsoft.VSTS.Scheduling.TargetDate', 'Target Date', 'dateTime'],
  ['Custom.Team', 'Team', 'string', false, true],
  ['Custom.Notes', 'Notes', 'plainText'],
];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function startMockAzure({ port = 0, host = '127.0.0.1', organization = 'acme', deployment = 'services', token = 'azure-pat' } = {}) {
  const requests = [];
  const project = { id: 'p-1', name: 'Fabrikam' };
  const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10) + 'T00:00:00Z';
  const iterations = [
    { id: 11, identifier: 'it-1', name: 'Sprint 1', attributes: { startDate: day(-28), finishDate: day(-14) } },
    { id: 12, identifier: 'it-2', name: 'Sprint 2', attributes: { startDate: day(-7), finishDate: day(7) } },
    { id: 13, identifier: 'it-3', name: 'Sprint 3', attributes: { startDate: day(7), finishDate: day(21) } },
  ];
  const users = [{ displayName: 'Freero bot', uniqueName: 'bot@azure.test' }];
  const items = new Map();
  let nextId = 1;
  let updates = 0;
  const pendingEdits = [];
  const afterEdits = [];
  let url = '';
  const base = `/${organization}`;

  const identity = (email) => {
    if (!email) return undefined;
    const u = users.find((x) => x.uniqueName.toLowerCase() === String(email).toLowerCase());
    return u ? { ...u } : { displayName: String(email).split('@')[0], uniqueName: String(email) };
  };
  const touch = (w) => {
    w.rev += 1;
    w.fields['System.Rev'] = w.rev;
    w.fields['System.ChangedDate'] = new Date().toISOString();
  };
  const view = (w, fields) => {
    const f = { ...w.fields };
    if (fields) for (const k of Object.keys(f)) if (!fields.includes(k)) delete f[k];
    return { id: w.id, rev: w.rev, fields: f, relations: w.relations, url: `${url}${base}/_apis/wit/workItems/${w.id}` };
  };

  function create(type, fields = {}) {
    const id = nextId++;
    const w = {
      id,
      rev: 0,
      fields: { 'System.Id': id, 'System.TeamProject': project.name, 'System.WorkItemType': type, 'System.State': 'New', 'System.IterationPath': project.name, 'System.Title': '', ...fields },
      relations: [],
    };
    touch(w);
    items.set(id, w);
    return w;
  }

  /** People editing in Azure DevOps (no service hook: checks post one when they want). */
  function edit(id, changes) {
    const w = items.get(Number(id));
    if (!w) throw new Error(`no work item ${id}`);
    if (changes.title !== undefined) w.fields['System.Title'] = changes.title;
    if (changes.state !== undefined) w.fields['System.State'] = changes.state;
    if (changes.iteration !== undefined) w.fields['System.IterationPath'] = changes.iteration ? `${project.name}\\${changes.iteration}` : project.name;
    if (changes.team !== undefined) w.fields['Custom.Team'] = changes.team;
    if (changes.description !== undefined) w.fields['System.Description'] = changes.description;
    touch(w);
    return w;
  }

  /** Applies JSON Patch ops to a work item; returns an error answer or null. */
  function apply(w, ops) {
    for (const op of ops) {
      if (op.op === 'test') {
        if (op.path === '/rev' && Number(op.value) !== w.rev)
          return [412, { $id: '1', message: `TF26071: This work item has been changed by someone else since you opened it. You will need to refresh it and discard your changes. (rev ${w.rev}, you had ${op.value})`, typeKey: 'WorkItemRevisionMismatchException' }];
        continue;
      }
      if (op.path === '/relations/-' && op.op === 'add') {
        w.relations.push(op.value);
        continue;
      }
      let m;
      if ((m = /^\/relations\/(\d+)$/.exec(op.path)) && op.op === 'remove') {
        w.relations.splice(Number(m[1]), 1);
        continue;
      }
      if ((m = /^\/fields\/(.+)$/.exec(op.path)) && (op.op === 'add' || op.op === 'replace')) {
        const field = m[1];
        if (!FIELDS.some(([ref]) => ref === field)) return [400, { message: `TF51535: Cannot find field ${field}.` }];
        if (field === 'System.State' && !STATES.some((s) => s.name === op.value)) return [400, { message: `The field 'State' contains the value '${op.value}' that is not in the list of supported values` }];
        if (field === 'System.IterationPath') {
          const name = String(op.value).slice(project.name.length + 1);
          if (op.value !== project.name && !iterations.some((i) => i.name === name)) return [400, { message: `TF401347: Invalid tree name given for work item ${w.id}, field 'System.IterationPath'.` }];
        }
        if (field === 'System.AssignedTo') w.fields[field] = op.value ? identity(op.value) : undefined;
        else w.fields[field] = op.value;
        if (w.fields[field] === undefined || w.fields[field] === '') delete w.fields[field];
        continue;
      }
      return [400, { message: `unsupported op ${op.op} ${op.path}` }];
    }
    return null;
  }

  // ---- WIQL (the clauses Freero and the checks use) ----
  function wiql(query) {
    const where = /\bWHERE\b([\s\S]*?)(\bORDER BY\b|$)/i.exec(query)?.[1] ?? '';
    const tests = where
      .split(/\s+AND\s+/i)
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        let m;
        if ((m = /^\[System\.TeamProject\]\s*=\s*'((?:[^']|'')*)'$/i.exec(c))) return (w) => w.fields['System.TeamProject'] === m[1].replace(/''/g, "'");
        if ((m = /^\[System\.IterationPath\]\s*=\s*'((?:[^']|'')*)'$/i.exec(c))) return (w) => w.fields['System.IterationPath'] === m[1].replace(/''/g, "'");
        if ((m = /^\[System\.Parent\]\s*=\s*(\d+)$/i.exec(c))) return (w) => w.relations.some((r) => r.rel === 'System.LinkTypes.Hierarchy-Reverse' && r.url.endsWith(`/${m[1]}`));
        if ((m = /^\[System\.Tags\]\s+CONTAINS\s+'([^']*)'$/i.exec(c))) return (w) => String(w.fields['System.Tags'] ?? '').split(';').map((t) => t.trim()).includes(m[1]);
        if ((m = /^\[System\.WorkItemType\]\s*=\s*'([^']*)'$/i.exec(c))) return (w) => w.fields['System.WorkItemType'] === m[1];
        throw new Error(`TF51006: The query statement is not supported by this mock: ${c}`);
      });
    return [...items.values()].filter((w) => tests.every((t) => t(w)));
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const raw = await readBody(req);
    const auth = req.headers.authorization ?? '';
    requests.push({ method: req.method, path: u.pathname, query: u.search, auth: auth.split(' ')[0] ?? '', body: raw });
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (auth !== `Basic ${Buffer.from(`:${token}`).toString('base64')}`) {
      res.writeHead(401, { 'content-type': 'text/html' });
      return res.end('<html>Access Denied: The Personal Access Token used has expired.</html>');
    }
    const want = deployment === 'server' ? '6.0' : '7.1';
    if (u.searchParams.get('api-version') !== want) return json(400, { message: `VS800006: The requested REST API version ${u.searchParams.get('api-version')} is not supported here (mock wants ${want}).` });
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      return json(400, { message: 'bad json' });
    }
    if (!u.pathname.startsWith(`${base}/`)) return json(404, { message: 'no such organization' });
    const path = decodeURIComponent(u.pathname.slice(base.length));
    const projectPath = `/${project.name}`;
    let m;

    if (path === '/_apis/connectionData') return json(200, { authenticatedUser: { providerDisplayName: 'Freero bot', properties: { Account: { $type: 'System.String', $value: 'bot@azure.test' } } } });
    if (path === '/_apis/wit/fields')
      return json(200, { count: FIELDS.length, value: FIELDS.map(([referenceName, name, type, readOnly, isPicklist]) => ({ referenceName, name, type, readOnly: !!readOnly, isPicklist: !!isPicklist })) });
    if (path === '/_apis/projects') return json(200, { count: 1, value: [project] });
    if (path === `${projectPath}/_apis/wit/workitemtypes`) return json(200, { count: TYPES.length, value: TYPES.map((name) => ({ name, isDisabled: false })) });
    if ((m = new RegExp(`^${projectPath}/_apis/wit/workitemtypes/([^/]+)/states$`).exec(path))) {
      if (!TYPES.includes(m[1])) return json(404, { message: `TF201036: work item type ${m[1]} not found` });
      return json(200, { count: STATES.length, value: STATES });
    }
    if (path === `${projectPath}/_apis/wit/classificationnodes/Iterations`)
      return json(200, { id: 10, identifier: 'root', name: project.name, structureType: 'iteration', hasChildren: true, children: iterations });
    if ((m = new RegExp(`^${projectPath}/_apis/wit/workitems/\\$(.+)$`).exec(path)) && req.method === 'POST') {
      if (!/json-patch\+json/.test(req.headers['content-type'] ?? '')) return json(415, { message: 'VS403427: The request indicated a Content-Type of application/json for method type POST which is not supported. Valid content types for this method are: application/json-patch+json.' });
      if (!TYPES.includes(m[1])) return json(404, { message: `TF201036: work item type ${m[1]} not found` });
      const w = create(m[1]);
      const err = apply(w, (body ?? []).filter((op) => op.op !== 'test'));
      if (err) {
        items.delete(w.id);
        return json(...err);
      }
      return json(200, view(w));
    }
    if ((m = /^\/_apis\/wit\/workitems\/(\d+)$/.exec(path))) {
      const w = items.get(Number(m[1]));
      if (!w) return json(404, { message: `TF401232: Work item ${m[1]} does not exist, or you do not have permissions to read it.` });
      if (req.method === 'GET') return json(200, view(w));
      if (req.method === 'PATCH') {
        if (!/json-patch\+json/.test(req.headers['content-type'] ?? '')) return json(415, { message: 'VS403427: wrong Content-Type' });
        // Someone else's edit lands between Freero's read and this write.
        const pending = pendingEdits.findIndex((p) => p.id === w.id);
        if (pending >= 0) edit(w.id, pendingEdits.splice(pending, 1)[0].changes);
        const copy = structuredClone(w);
        const err = apply(copy, body ?? []);
        if (err) return json(...err);
        Object.assign(w, copy);
        touch(w);
        updates++;
        const answer = view(w);
        // Someone edits it the moment this write lands, before anyone reads it again.
        const after = afterEdits.findIndex((p) => p.id === w.id);
        if (after >= 0) edit(w.id, afterEdits.splice(after, 1)[0].changes);
        return json(200, answer);
      }
    }
    if (path === '/_apis/wit/workitemsbatch' && req.method === 'POST') {
      const found = (body?.ids ?? []).map((id) => items.get(Number(id))).filter(Boolean);
      return json(200, { count: found.length, value: found.map((w) => view(w, body?.fields)) });
    }
    if ((path === '/_apis/wit/wiql' || path === `${projectPath}/_apis/wit/wiql`) && req.method === 'POST') {
      try {
        const top = Number(u.searchParams.get('$top') ?? 200);
        return json(200, { queryType: 'flat', workItems: wiql(String(body?.query ?? '')).slice(0, top).map((w) => ({ id: w.id, url: `${url}${base}/_apis/wit/workItems/${w.id}` })) });
      } catch (e) {
        return json(400, { message: e.message });
      }
    }
    return json(404, { message: `mock: no route ${req.method} ${path}` });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  url = `http://${host}:${server.address().port}`;
  return {
    url,
    site: `${url}${base}`,
    token,
    project: project.name,
    requests,
    items,
    create,
    edit,
    updates: () => updates,
    addUser: (email, name) => users.push({ displayName: name, uniqueName: email }),
    item: (id) => {
      const w = items.get(Number(String(id).replace(/^#/, '')));
      return w ? { ...view(w), title: w.fields['System.Title'], state: w.fields['System.State'], iteration: w.fields['System.IterationPath'], team: w.fields['Custom.Team'] ?? null } : null;
    },
    /** The next PATCH of work item `id` finds it changed by someone else first. */
    editBeforeNextPatch: (id, changes) => pendingEdits.push({ id: Number(id), changes }),
    /** Right after the next PATCH of work item `id` lands, someone edits it (before Freero reads it back). */
    editAfterNextPatch: (id, changes) => afterEdits.push({ id: Number(id), changes }),
    pendingAfterEdits: () => afterEdits.length,
    /** Posts a service hook delivery ("Work item updated") about `id` to `target`. */
    async webhook(target, secret, id, { eventType = 'workitem.updated' } = {}) {
      const payload = JSON.stringify({
        subscriptionId: 'sub-1',
        eventType,
        publisherId: 'tfs',
        resource: eventType === 'workitem.updated' ? { id: 1000 + Number(id), workItemId: Number(id), rev: items.get(Number(id))?.rev } : { id: Number(id) },
      });
      const r = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`freero:${secret}`).toString('base64')}` }, body: payload });
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
  const a = await startMockAzure({ port: Number(arg('--port', '4484')), deployment: arg('--deployment', 'services') });
  a.addUser('demo@freero.app', 'Demo User');
  console.log(`mock Azure DevOps (${arg('--deployment', 'services')}) at ${a.site} (personal access token ${a.token}; project ${a.project})`);
}
