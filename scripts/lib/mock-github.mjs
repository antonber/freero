// Test-only GitHub (Enterprise Server layout: the REST API under /api/v3, GraphQL at /api/graphql):
// the subset of GitHub's public API Freero's tracker sync uses, in memory, for `npm run verify` (and
// the UI by hand). Never the real GitHub.
//
//   REST     issues (assignees, labels, milestones added / removed one by one, sub-issues), users
//            with public emails, user search by email, milestones
//   GraphQL  the queries and mutations Freero sends (matched by what they ask for, not parsed):
//            Projects (v2) by owner and number, an issue's Project items and their field values,
//            a Project's items, updateProjectV2ItemFieldValue / clear… / addProjectV2ItemById
//
// Project "acme/3" has fields Status (Todo, In Progress, In Review, Done), Estimate (number), Start
// date and Target date (dates), Iteration (Iteration 1 completed, Iteration 2 current, Iteration 3
// next) and Team (Web / Mobile). Changing a Project field doesn't change the issue's updated_at, like
// GitHub. Checks edit like people would: `edit(repo, n, { body, state, assignees, milestone })`,
// `setField(repo, n, fieldName, value)` (in the Project), `webhook(url, secret, repo, n)` (signed
// with X-Hub-Signature-256), `block(repo, n, blockedBy)` / `unblock(…)` (dependencies, #50).
//
//   node scripts/lib/mock-github.mjs --port 4484

import { createHmac } from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

export async function startMockGithub({ port = 0, host = '127.0.0.1', token = 'ghp_mock_token' } = {}) {
  const requests = [];
  const repos = [{ id: 1, full_name: 'acme/web' }];
  const issues = new Map(); // `${repo}#${n}` -> issue
  const counters = new Map();
  const users = new Map([['freero-bot', { login: 'freero-bot', email: null }]]);
  const milestones = new Map(); // repo -> [{ number, title, due_on, state }]
  let seq = 1000;
  let url = '';

  // ---- the Project (v2) ----
  const opt = (name) => ({ id: `opt_${name.replace(/\W/g, '').toLowerCase()}`, name });
  const project = {
    id: 'PVT_acme3',
    owner: 'acme',
    number: 3,
    fields: [
      { id: 'PVTF_title', name: 'Title', dataType: 'TITLE' },
      { id: 'PVTSSF_status', name: 'Status', dataType: 'SINGLE_SELECT', options: ['Todo', 'In Progress', 'In Review', 'Done'].map(opt) },
      { id: 'PVTF_estimate', name: 'Estimate', dataType: 'NUMBER' },
      { id: 'PVTF_start', name: 'Start date', dataType: 'DATE' },
      { id: 'PVTF_target', name: 'Target date', dataType: 'DATE' },
      {
        id: 'PVTIF_iteration',
        name: 'Iteration',
        dataType: 'ITERATION',
        configuration: {
          completedIterations: [{ id: 'it1', title: 'Iteration 1', startDate: day(-21), duration: 14 }],
          iterations: [
            { id: 'it2', title: 'Iteration 2', startDate: day(-7), duration: 14 },
            { id: 'it3', title: 'Iteration 3', startDate: day(7), duration: 14 },
          ],
        },
      },
      { id: 'PVTSSF_team', name: 'Team', dataType: 'SINGLE_SELECT', options: ['Web', 'Mobile'].map(opt) },
    ],
  };
  const items = new Map(); // issue key -> { id, values: { fieldId: value }, updatedAt }
  const fieldNamed = (name) => project.fields.find((f) => f.name === name);
  const iterationOf = (id) => [...project.fields.find((f) => f.dataType === 'ITERATION').configuration.iterations, ...project.fields.find((f) => f.dataType === 'ITERATION').configuration.completedIterations].find((i) => i.id === id);

  const touch = (i) => (i.updated_at = new Date().toISOString());
  const view = (repo, i) => ({
    id: i.id,
    node_id: i.node_id,
    number: i.number,
    html_url: `${url}/${repo}/issues/${i.number}`,
    title: i.title,
    body: i.body,
    state: i.state,
    labels: i.labels.map((name) => ({ name })),
    assignees: i.assignees.map((login) => ({ login })),
    milestone: i.milestone ? { ...(milestones.get(repo) ?? []).find((m) => m.number === i.milestone) } : null,
    updated_at: i.updated_at,
    repository_url: `${url}/api/v3/repos/${repo}`,
  });
  const make = (repo, fields) => {
    if (!repos.some((r) => r.full_name === repo)) repos.push({ id: repos.length + 1, full_name: repo });
    const n = (counters.get(repo) ?? 0) + 1;
    counters.set(repo, n);
    const i = { id: ++seq, node_id: `I_${repo.replace('/', '_')}_${n}`, number: n, title: '', body: '', state: 'open', labels: [], assignees: [], milestone: null, parent: null, blockedBy: [], ...fields };
    touch(i);
    issues.set(`${repo}#${n}`, i);
    return n;
  };
  const byNode = (nodeId) => [...issues].find(([, i]) => i.node_id === nodeId);
  const itemValues = (it) =>
    Object.entries(it.values).map(([fid, v]) => {
      const f = project.fields.find((x) => x.id === fid);
      const base = { field: { id: fid } };
      if (f.dataType === 'SINGLE_SELECT') return { __typename: 'ProjectV2ItemFieldSingleSelectValue', name: f.options.find((o) => o.id === v)?.name, optionId: v, ...base };
      if (f.dataType === 'NUMBER') return { __typename: 'ProjectV2ItemFieldNumberValue', number: v, ...base };
      if (f.dataType === 'DATE') return { __typename: 'ProjectV2ItemFieldDateValue', date: v, ...base };
      if (f.dataType === 'ITERATION') return { __typename: 'ProjectV2ItemFieldIterationValue', title: iterationOf(v)?.title, iterationId: v, ...base };
      return { __typename: 'ProjectV2ItemFieldTextValue', text: v, ...base };
    });
  const projectView = () => ({ id: project.id, fields: { nodes: project.fields.map((f) => ({ __typename: 'X', ...f })) } });
  const addItem = (key) => {
    if (!items.has(key)) items.set(key, { id: `PVTI_${++seq}`, values: {}, updatedAt: new Date().toISOString() });
    return items.get(key);
  };

  function graphql(q, v) {
    if (/organization\(login/.test(q)) return { data: { organization: v.login === project.owner && v.number === project.number ? { projectV2: projectView() } : null, user: null } };
    if (/addProjectV2ItemById/.test(q)) {
      const hit = byNode(v.c);
      if (v.p !== project.id || !hit) return { errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a node' }] };
      return { data: { addProjectV2ItemById: { item: { id: addItem(hit[0]).id } } } };
    }
    if (/updateProjectV2ItemFieldValue|clearProjectV2ItemFieldValue/.test(q)) {
      const it = [...items.values()].find((x) => x.id === v.i);
      const f = project.fields.find((x) => x.id === v.f);
      if (!it || !f) return { errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a node' }] };
      if (/clear/.test(q)) delete it.values[f.id];
      else {
        const val = v.v.singleSelectOptionId ?? v.v.number ?? v.v.date ?? v.v.iterationId ?? v.v.text;
        if (f.dataType === 'SINGLE_SELECT' && !f.options.some((o) => o.id === val)) return { errors: [{ message: 'The single select option Id does not belong to the field' }] };
        if (f.dataType === 'ITERATION' && !iterationOf(val)) return { errors: [{ message: 'The iteration Id does not belong to the field' }] };
        it.values[f.id] = val;
      }
      it.updatedAt = new Date().toISOString();
      return { data: { x: { projectV2Item: { id: it.id } } } };
    }
    if (/node\(id: \$id\) \{ \.\.\. on ProjectV2 \{ items/.test(q)) {
      if (v.id !== project.id) return { data: { node: null } };
      return {
        data: {
          node: {
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [...items].map(([key, it]) => ({ updatedAt: it.updatedAt, content: { number: Number(key.split('#')[1]), repository: { nameWithOwner: key.split('#')[0] } }, fieldValues: { nodes: itemValues(it) } })),
            },
          },
        },
      };
    }
    if (/node\(id: \$id\)/.test(q)) return { data: { node: v.id === project.id ? projectView() : null } };
    if (/repository\(owner/.test(q)) {
      const key = `${v.owner}/${v.name}#${v.number}`;
      const i = issues.get(key);
      if (!i) return { data: { repository: { issue: null } }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to an Issue' }] };
      const it = items.get(key);
      return { data: { repository: { issue: { id: i.node_id, projectItems: { nodes: it ? [{ id: it.id, project: { id: project.id }, fieldValues: { nodes: itemValues(it) } }] : [] } } } } };
    }
    return { errors: [{ message: `mock: no GraphQL for ${q.slice(0, 80)}` }] };
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const u = new URL(req.url, 'http://x');
      requests.push({ method: req.method, path: u.pathname, body: raw });
      const json = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.headers.authorization !== `Bearer ${token}`) return json(401, { message: 'Bad credentials' });
      const body = raw ? JSON.parse(raw) : {};
      let m;
      if (u.pathname === '/api/graphql' && req.method === 'POST') return json(200, graphql(String(body.query ?? ''), body.variables ?? {}));
      if (u.pathname === '/api/v3/user') return json(200, { login: 'freero-bot' });
      if (u.pathname === '/api/v3/user/repos') return json(200, repos);
      if ((m = /^\/api\/v3\/users\/([\w-]+)$/.exec(u.pathname))) {
        const user = users.get(m[1]);
        return user ? json(200, { login: user.login, email: user.email }) : json(404, { message: 'Not Found' });
      }
      if (u.pathname === '/api/v3/search/users') {
        const email = /(\S+@\S+) in:email/.exec(u.searchParams.get('q') ?? '')?.[1]?.toLowerCase();
        const found = [...users.values()].filter((x) => x.email && x.email.toLowerCase() === email);
        return json(200, { total_count: found.length, items: found.map((x) => ({ login: x.login })) });
      }
      if ((m = /^\/api\/v3\/repos\/([\w.-]+\/[\w.-]+)\/milestones$/.exec(u.pathname))) return json(200, (milestones.get(m[1]) ?? []).filter((x) => x.state === (u.searchParams.get('state') ?? 'open')));
      if ((m = /^\/api\/v3\/repos\/([\w.-]+\/[\w.-]+)\/issues$/.exec(u.pathname))) {
        const repo = m[1];
        if (!repos.some((r) => r.full_name === repo)) return json(404, { message: 'Not Found' });
        if (req.method === 'POST') {
          const n = make(repo, { title: body.title, body: body.body ?? '', labels: body.labels ?? [] });
          return json(201, view(repo, issues.get(`${repo}#${n}`)));
        }
        const since = Date.parse(u.searchParams.get('since') ?? '1970-01-01');
        return json(200, [...issues].filter(([k, i]) => k.startsWith(`${repo}#`) && Date.parse(i.updated_at) >= since).map(([, i]) => view(repo, i)));
      }
      if ((m = /^\/api\/v3\/repos\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)(\/.*)?$/.exec(u.pathname))) {
        const repo = m[1];
        const key = `${repo}#${m[2]}`;
        const i = issues.get(key);
        if (!i) return json(404, { message: 'Not Found' });
        const rest = m[3] ?? '';
        if (rest === '/labels' && req.method === 'POST') {
          i.labels = [...new Set([...i.labels, ...(body.labels ?? [])])];
          touch(i);
          return json(200, i.labels.map((name) => ({ name })));
        }
        if (rest.startsWith('/labels/') && req.method === 'DELETE') {
          const name = decodeURIComponent(rest.slice('/labels/'.length));
          if (!i.labels.includes(name)) return json(404, { message: 'Label does not exist' });
          i.labels = i.labels.filter((x) => x !== name);
          touch(i);
          return json(200, i.labels.map((n) => ({ name: n })));
        }
        if (rest === '/assignees') {
          const logins = body.assignees ?? [];
          if (req.method === 'POST') {
            // GitHub quietly skips people who can't be assigned.
            i.assignees = [...new Set([...i.assignees, ...logins.filter((l) => users.has(l))])];
          } else i.assignees = i.assignees.filter((l) => !logins.includes(l));
          touch(i);
          return json(201, view(repo, i));
        }
        if (rest === '/sub_issues') {
          if (req.method === 'POST') {
            const child = [...issues.values()].find((x) => x.id === body.sub_issue_id);
            if (!child) return json(422, { message: 'Validation Failed: sub_issue_id' });
            child.parent = key;
            touch(child);
            return json(201, view(repo, i));
          }
          return json(200, [...issues].filter(([, x]) => x.parent === key).map(([k, x]) => view(k.split('#')[0], x)));
        }
        if ((rest === '/dependencies/blocked_by' || rest.startsWith('/dependencies/blocked_by/')) && req.method !== 'GET') {
          if (req.method === 'POST') {
            const blocker = [...issues].find(([, x]) => x.id === body.issue_id);
            if (!blocker) return json(422, { message: 'Validation Failed: issue_id' });
            if (!i.blockedBy.includes(blocker[0])) i.blockedBy.push(blocker[0]);
          } else {
            const id = Number(rest.split('/').pop());
            const blocker = [...issues].find(([, x]) => x.id === id);
            if (!blocker || !i.blockedBy.includes(blocker[0])) return json(404, { message: 'Not Found' });
            i.blockedBy = i.blockedBy.filter((k) => k !== blocker[0]);
          }
          touch(i);
          return json(req.method === 'POST' ? 201 : 204, req.method === 'POST' ? view(repo, i) : {});
        }
        if (rest === '/dependencies/blocked_by') return json(200, i.blockedBy.map((k) => view(k.split('#')[0], issues.get(k))));
        if (rest === '/dependencies/blocking') return json(200, [...issues].filter(([, x]) => x.blockedBy.includes(key)).map(([k, x]) => view(k.split('#')[0], x)));
        if (rest) return json(404, { message: `no route ${req.method} ${u.pathname}` });
        if (req.method === 'PATCH') {
          for (const k of ['title', 'body', 'state', 'labels']) if (body[k] !== undefined) i[k] = body[k];
          if (body.milestone !== undefined) {
            if (body.milestone !== null && !(milestones.get(repo) ?? []).some((x) => x.number === body.milestone)) return json(422, { message: 'Validation Failed: milestone' });
            i.milestone = body.milestone;
          }
          touch(i);
        }
        return json(200, view(repo, i));
      }
      if (u.pathname === '/api/v3/search/issues') {
        // The qualifiers Freero's checks use: repo:, is:open / is:closed, label:x or label:"x y"; the rest is words in the title.
        const q = u.searchParams.get('q') ?? '';
        const repo = /repo:([\w.-]+\/[\w.-]+)/.exec(q)?.[1];
        const state = /\bis:(open|closed)\b/.exec(q)?.[1];
        const labels = [...q.matchAll(/\blabel:(?:"([^"]+)"|(\S+))/g)].map((m) => (m[1] ?? m[2]).toLowerCase());
        const words = q.replace(/\blabel:(?:"[^"]+"|\S+)/g, '').replace(/\b(repo|is):\S+/g, '').trim().toLowerCase();
        const found = [...issues]
          .filter(([k, i]) => (!repo || k.startsWith(`${repo}#`)) && (!state || i.state === state) && labels.every((l) => i.labels.some((x) => x.toLowerCase() === l)) && (!words || i.title.toLowerCase().includes(words)))
          .map(([k, i]) => view(k.split('#')[0], i));
        return json(200, { total_count: found.length, items: found });
      }
      return json(404, { message: `no route ${req.method} ${u.pathname}` });
    });
  });
  await new Promise((r, j) => {
    server.once('error', j);
    server.listen(port, host, r);
  });
  url = `http://${host}:${server.address().port}`;
  return {
    url,
    token,
    requests,
    project: `${project.owner}/${project.number}`,
    issue: (repo, n) => {
      const i = issues.get(`${repo}#${n}`);
      if (!i) return null;
      const it = items.get(`${repo}#${n}`);
      const fields = it ? Object.fromEntries(Object.entries(it.values).map(([fid, v]) => {
        const f = project.fields.find((x) => x.id === fid);
        return [f.name, f.dataType === 'SINGLE_SELECT' ? f.options.find((o) => o.id === v)?.name : f.dataType === 'ITERATION' ? iterationOf(v)?.title : v];
      })) : null;
      return { ...i, milestoneDue: i.milestone ? (milestones.get(repo) ?? []).find((x) => x.number === i.milestone)?.due_on?.slice(0, 10) : null, fields };
    },
    /** An issue people made on GitHub (its number). The repository is added if it isn't there. */
    create(repo, { title, body = '', labels = [], state = 'open', assignees = [], milestone = null }) {
      return make(repo, { title, body, labels, state, assignees, milestone });
    },
    edit(repo, n, changes) {
      const i = issues.get(`${repo}#${n}`);
      Object.assign(i, changes);
      touch(i);
    },
    /** A GitHub account; `email` shows on its public profile (null: hidden). */
    addUser: (login, email = null) => users.set(login, { login, email }),
    /** A milestone of `repo` due on `due` (YYYY-MM-DD); its number. */
    addMilestone(repo, title, due) {
      const list = milestones.get(repo) ?? [];
      const ms = { number: list.length + 1, title, due_on: `${due}T07:00:00Z`, state: 'open' };
      milestones.set(repo, [...list, ms]);
      return ms.number;
    },
    /** People in the Project: put the issue in it, and set a field by name (an option's / iteration's name, a number, a date; null clears). */
    setField(repo, n, name, value) {
      const it = addItem(`${repo}#${n}`);
      const f = fieldNamed(name);
      if (value === null) delete it.values[f.id];
      else if (f.dataType === 'SINGLE_SELECT') it.values[f.id] = f.options.find((o) => o.name === value).id;
      else if (f.dataType === 'ITERATION') it.values[f.id] = [...f.configuration.iterations, ...f.configuration.completedIterations].find((x) => x.title === value).id;
      else it.values[f.id] = value;
      it.updatedAt = new Date().toISOString();
    },
    subIssues: (repo, n) => [...issues].filter(([, x]) => x.parent === `${repo}#${n}`).map(([k]) => k),
    /** People on GitHub: `repo#n` is blocked by `blocker` ("owner/name#m"). */
    block(repo, n, blocker) {
      const i = issues.get(`${repo}#${n}`);
      if (!i.blockedBy.includes(blocker)) i.blockedBy.push(blocker);
      touch(i);
      touch(issues.get(blocker));
    },
    unblock(repo, n, blocker) {
      const i = issues.get(`${repo}#${n}`);
      i.blockedBy = i.blockedBy.filter((k) => k !== blocker);
      touch(i);
      touch(issues.get(blocker));
    },
    async webhook(target, secret, repo, n) {
      const payload = Buffer.from(JSON.stringify({ action: 'edited', issue: { number: n }, repository: { full_name: repo } }));
      const r = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': 'issues', 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}` }, body: payload });
      return r.status;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--port');
  const g = await startMockGithub({ port: Number(i >= 0 ? process.argv[i + 1] : 4484) });
  const n = g.create('acme/web', { title: 'Pricing page' });
  g.setField('acme/web', n, 'Status', 'In Progress');
  console.log(`mock GitHub (Enterprise layout) on ${g.url} (token ${g.token}; repo acme/web; Project ${g.project})`);
}
