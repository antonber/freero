// Test-only Linear: the subset of Linear's public GraphQL API Freero's tracker sync uses, in
// memory, for `npm run verify` (and the UI by hand). Never the real Linear. Queries are matched by
// the fields they ask for — enough for Freero's own queries, not a GraphQL engine. Personal API
// keys go in the Authorization header as they are (like Linear's).
//
// Checks drive it like people in Linear would: `edit(key, { stateType, title })`, and
// `webhook(url, secret, key, { age })` posts a delivery signed with Linear-Signature (an `age`
// makes it look old: a replay).
//
// Cycles (#119): team ENG has cycle 1 (completed), 2 (current) and 3 (upcoming);
// `edit(key, { cycle: number | null })` moves an issue between them.
//
//   node scripts/lib/mock-linear.mjs --port 4483

import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export async function startMockLinear({ port = 0, host = '127.0.0.1', apiKey = 'lin_api_mock_key' } = {}) {
  const requests = [];
  const teams = [{ id: randomUUID(), key: 'ENG', name: 'Engineering' }];
  const states = [];
  for (const t of teams)
    for (const [name, type, position] of [
      ['Backlog', 'backlog', 0],
      ['Todo', 'unstarted', 1],
      ['In Progress', 'started', 2],
      ['Done', 'completed', 3],
    ])
      states.push({ id: randomUUID(), teamId: t.id, name, type, position });
  const labels = [];
  const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString();
  const cycles = teams.flatMap((t) => [
    { id: randomUUID(), teamId: t.id, number: 1, name: null, startsAt: day(-28), endsAt: day(-14), completedAt: day(-14) },
    { id: randomUUID(), teamId: t.id, number: 2, name: null, startsAt: day(-7), endsAt: day(7), completedAt: null },
    { id: randomUUID(), teamId: t.id, number: 3, name: 'Polish', startsAt: day(7), endsAt: day(21), completedAt: null },
  ]);
  const cycleView = (c) => (c ? { id: c.id, number: c.number, name: c.name, startsAt: c.startsAt, endsAt: c.endsAt, completedAt: c.completedAt } : null);
  const users = [];
  const issues = [];
  /** "blocks" relations (#50): issue `from` blocks issue `to`. */
  const relations = [];
  const counters = new Map();
  let url = '';

  const stateOf = (i) => states.find((s) => s.id === i.stateId);
  const view = (i) => ({
    id: i.id,
    identifier: i.identifier,
    url: `${url}/issue/${i.identifier}`,
    title: i.title,
    description: i.description,
    updatedAt: i.updatedAt,
    dueDate: i.dueDate,
    estimate: i.estimate,
    state: { name: stateOf(i).name, type: stateOf(i).type },
    assignee: i.assigneeId ? users.find((u) => u.id === i.assigneeId) : null,
    labels: { nodes: i.labelIds.map((id) => ({ name: labels.find((l) => l.id === id).name })) },
    team: { id: i.teamId, key: teams.find((t) => t.id === i.teamId).key, name: teams.find((t) => t.id === i.teamId).name },
    project: i.projectName ? { name: i.projectName } : null,
    parent: i.parentId ? { title: issues.find((p) => p.id === i.parentId)?.title ?? '' } : null,
    cycle: cycleView(cycles.find((c) => c.id === i.cycleId)),
    attachments: { nodes: i.attachments },
    relations: { nodes: relations.filter((r) => r.from === i.id).map((r) => ({ id: r.id, type: 'blocks', relatedIssue: { id: r.to } })) },
    inverseRelations: { nodes: relations.filter((r) => r.to === i.id).map((r) => ({ id: r.id, type: 'blocks', issue: { id: r.from } })) },
  });
  const touch = (i) => (i.updatedAt = new Date().toISOString());
  const find = (idOrKey) => issues.find((i) => i.id === idOrKey || i.identifier === idOrKey);

  function apply(i, input) {
    if (input.title !== undefined) i.title = input.title;
    if (input.description !== undefined) i.description = input.description;
    if (input.labelIds !== undefined) i.labelIds = input.labelIds;
    if (input.dueDate !== undefined) i.dueDate = input.dueDate;
    if (input.estimate !== undefined) i.estimate = input.estimate;
    if (input.stateId !== undefined) i.stateId = input.stateId;
    if (input.assigneeId !== undefined) i.assigneeId = input.assigneeId;
    if (input.projectName !== undefined) i.projectName = input.projectName;
    if (input.cycleId !== undefined) i.cycleId = input.cycleId;
    if (input.parentId !== undefined) i.parentId = input.parentId;
    touch(i);
  }

  function resolve(query, v) {
    if (/issueRelationCreate/.test(query)) {
      const a = find(v.a);
      const b = find(v.b);
      if (!a || !b) return { errors: [{ message: 'Entity not found: Issue' }] };
      if (!/type: blocks/.test(query)) return { errors: [{ message: 'mock: only blocks relations' }] };
      if (!relations.some((r) => r.from === a.id && r.to === b.id)) relations.push({ id: randomUUID(), from: a.id, to: b.id });
      touch(a);
      touch(b);
      return { data: { issueRelationCreate: { success: true } } };
    }
    if (/issueRelationDelete/.test(query)) {
      const at = relations.findIndex((r) => r.id === v.id);
      if (at < 0) return { errors: [{ message: 'Entity not found: IssueRelation' }] };
      const [r] = relations.splice(at, 1);
      for (const id of [r.from, r.to]) touch(find(id));
      return { data: { issueRelationDelete: { success: true } } };
    }
    if (/issueCreate\(/.test(query)) {
      const team = teams.find((t) => t.id === v.input.teamId);
      if (!team) return { errors: [{ message: 'Entity not found: Team' }] };
      const n = (counters.get(team.key) ?? 0) + 1;
      counters.set(team.key, n);
      const i = { id: randomUUID(), identifier: `${team.key}-${n}`, title: '', description: '', labelIds: [], dueDate: null, estimate: null, assigneeId: null, teamId: team.id, stateId: states.find((s) => s.teamId === team.id && s.type === 'unstarted').id, attachments: [] };
      apply(i, v.input);
      issues.push(i);
      return { data: { issueCreate: { success: true, issue: view(i) } } };
    }
    if (/issueUpdate\(/.test(query)) {
      const i = find(v.id);
      if (!i) return { errors: [{ message: 'Entity not found: Issue' }] };
      apply(i, v.input);
      return { data: { issueUpdate: { success: true } } };
    }
    if (/issueLabelCreate/.test(query)) {
      const l = { id: randomUUID(), name: v.name, teamId: v.teamId };
      labels.push(l);
      return { data: { issueLabelCreate: { issueLabel: { id: l.id } } } };
    }
    if (/attachmentCreate/.test(query)) {
      const i = find(v.input.issueId);
      if (!i) return { errors: [{ message: 'Entity not found: Issue' }] };
      const known = i.attachments.find((a) => a.url === v.input.url);
      if (known) known.title = v.input.title;
      else i.attachments.push({ id: randomUUID(), url: v.input.url, title: v.input.title });
      return { data: { attachmentCreate: { success: true } } };
    }
    if (/attachmentDelete/.test(query)) {
      for (const i of issues) i.attachments = i.attachments.filter((a) => a.id !== v.id);
      return { data: { attachmentDelete: { success: true } } };
    }
    if (/\bviewer\b/.test(query)) return { data: { viewer: { name: 'Freero bot', email: 'bot@linear.test' } } };
    if (/teams\(filter/.test(query)) return { data: { teams: { nodes: teams.filter((t) => t.key === v.key) } } };
    if (/teams\(first/.test(query)) return { data: { teams: { nodes: teams } } };
    if (/issueLabels\(/.test(query)) return { data: { issueLabels: { nodes: labels.filter((l) => (v.names ?? []).some((n) => n.toLowerCase() === l.name.toLowerCase())) } } };
    if (/workflowStates\(/.test(query)) return { data: { workflowStates: { nodes: states.filter((s) => s.teamId === v.team && (v.types ?? []).includes(s.type)) } } };
    if (/users\(filter/.test(query)) return { data: { users: { nodes: users.filter((u) => u.email === v.email) } } };
    if (/searchIssues\(/.test(query)) return { data: { searchIssues: { nodes: issues.filter((i) => i.title.toLowerCase().includes(String(v.term).toLowerCase())).slice(0, v.first ?? 50).map(view) } } };
    if (/team\(id/.test(query)) {
      const t = teams.find((x) => x.id === v.id);
      return t ? { data: { team: { cycles: { nodes: cycles.filter((c) => c.teamId === t.id).map(cycleView) } } } } : { errors: [{ message: 'Entity not found: Team' }] };
    }
    if (/issues\(filter: \$filter/.test(query)) {
      const f = v.filter ?? {};
      const hit = issues.filter((i) => (!f.team || i.teamId === f.team.id.eq) && (!f.cycle || i.cycleId === f.cycle.id.eq) && (!f.parent || i.parentId === f.parent.id.eq));
      return { data: { issues: { nodes: hit.slice(0, v.first ?? 50).map(view) } } };
    }
    if (/issues\(filter/.test(query))
      return { data: { issues: { nodes: issues.filter((i) => (v.ids ?? []).includes(i.id) && Date.parse(i.updatedAt) >= Date.parse(v.since)).map((i) => ({ id: i.id })) } } };
    if (/issue\(id/.test(query)) {
      const i = find(v.id);
      return i ? { data: { issue: view(i) } } : { errors: [{ message: 'Entity not found: Issue' }] };
    }
    return { errors: [{ message: `mock: unsupported query ${query.slice(0, 80)}` }] };
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method, path: req.url, body: raw });
      const json = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url !== '/graphql' || req.method !== 'POST') return json(404, { errors: [{ message: 'not found' }] });
      if (req.headers.authorization !== apiKey) return json(400, { errors: [{ message: 'Authentication required, not authenticated', extensions: { code: 'AUTHENTICATION_ERROR' } }] });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, { errors: [{ message: 'bad json' }] });
      }
      json(200, resolve(String(body.query ?? ''), body.variables ?? {}));
    });
  });
  await new Promise((r, j) => {
    server.once('error', j);
    server.listen(port, host, r);
  });
  url = `http://${host}:${server.address().port}`;
  return {
    url,
    apiKey,
    requests,
    addUser: (email, name) => users.push({ id: randomUUID(), email, name }),
    /** An issue made in Linear (not through Freero). */
    create(teamKey, input = {}) {
      const team = teams.find((t) => t.key === teamKey);
      const n = (counters.get(team.key) ?? 0) + 1;
      counters.set(team.key, n);
      const i = { id: randomUUID(), identifier: `${team.key}-${n}`, title: '', description: '', labelIds: [], dueDate: null, estimate: null, assigneeId: null, teamId: team.id, stateId: states.find((s) => s.teamId === team.id && s.type === 'unstarted').id, attachments: [] };
      apply(i, input);
      issues.push(i);
      return view(i);
    },
    issueByKey: (key) => {
      const i = find(key);
      return i ? { ...view(i), labels: i.labelIds.map((id) => labels.find((l) => l.id === id).name), attachments: i.attachments } : null;
    },
    edit(key, changes) {
      const i = find(key);
      if (changes.title !== undefined) i.title = changes.title;
      if (changes.stateType !== undefined) i.stateId = states.find((s) => s.teamId === i.teamId && s.type === changes.stateType).id;
      if (changes.cycle !== undefined) i.cycleId = changes.cycle === null ? null : cycles.find((c) => c.teamId === i.teamId && c.number === changes.cycle).id;

      touch(i);
    },
    /** People in Linear (#50): `blocker` blocks `blocked` (keys); `unblock` removes it. */
    block(blocker, blocked) {
      const a = find(blocker);
      const b = find(blocked);
      relations.push({ id: randomUUID(), from: a.id, to: b.id });
      touch(a);
      touch(b);
    },
    unblock(blocker, blocked) {
      const a = find(blocker);
      const b = find(blocked);
      const at = relations.findIndex((r) => r.from === a.id && r.to === b.id);
      if (at >= 0) relations.splice(at, 1);
      touch(a);
      touch(b);
    },
    blocks: (key) => relations.filter((r) => r.from === find(key).id).map((r) => issues.find((i) => i.id === r.to).identifier),
    /** A delivery about `key`, signed like Linear signs them; `age` back-dates its timestamp. */
    async webhook(target, secret, key, { age = 0 } = {}) {
      const i = find(key);
      const payload = Buffer.from(JSON.stringify({ action: 'update', type: 'Issue', data: { id: i.id, identifier: i.identifier }, webhookTimestamp: Date.now() - age }));
      const r = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', 'linear-signature': createHmac('sha256', secret).update(payload).digest('hex') }, body: payload });
      return r.status;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--port');
  const l = await startMockLinear({ port: Number(i >= 0 ? process.argv[i + 1] : 4483) });
  console.log(`mock Linear on ${l.url} (API key ${l.apiKey}; team ENG)`);
}
