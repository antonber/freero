// Test-only GitHub (Enterprise Server layout: the REST API under /api/v3): the subset of GitHub's
// public REST API Freero's tracker sync uses, in memory, for `npm run verify` (and the UI by hand).
// Never the real GitHub. Checks edit issues like people would (`edit(repo, n, { body, state })`)
// and post webhooks signed with X-Hub-Signature-256 (`webhook(url, secret, repo, n)`).
//
//   node scripts/lib/mock-github.mjs --port 4484

import { createHmac } from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export async function startMockGithub({ port = 0, host = '127.0.0.1', token = 'ghp_mock_token' } = {}) {
  const requests = [];
  const repos = [{ id: 1, full_name: 'acme/web' }];
  const issues = new Map(); // `${repo}#${n}` -> issue
  const counters = new Map();
  let url = '';

  const view = (repo, i) => ({
    number: i.number,
    html_url: `${url}/${repo}/issues/${i.number}`,
    title: i.title,
    body: i.body,
    state: i.state,
    labels: i.labels.map((name) => ({ name })),
    updated_at: i.updated_at,
    repository_url: `${url}/api/v3/repos/${repo}`,
  });
  const touch = (i) => (i.updated_at = new Date().toISOString());

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
      if (u.pathname === '/api/v3/user') return json(200, { login: 'freero-bot' });
      if (u.pathname === '/api/v3/user/repos') return json(200, repos);
      if ((m = /^\/api\/v3\/repos\/([\w.-]+\/[\w.-]+)\/issues$/.exec(u.pathname))) {
        const repo = m[1];
        if (!repos.some((r) => r.full_name === repo)) return json(404, { message: 'Not Found' });
        if (req.method === 'POST') {
          const n = (counters.get(repo) ?? 0) + 1;
          counters.set(repo, n);
          const i = { number: n, title: body.title, body: body.body ?? '', state: 'open', labels: body.labels ?? [] };
          touch(i);
          issues.set(`${repo}#${n}`, i);
          return json(201, view(repo, i));
        }
        const since = Date.parse(u.searchParams.get('since') ?? '1970-01-01');
        return json(200, [...issues].filter(([k, i]) => k.startsWith(`${repo}#`) && Date.parse(i.updated_at) >= since).map(([, i]) => view(repo, i)));
      }
      if ((m = /^\/api\/v3\/repos\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)$/.exec(u.pathname))) {
        const i = issues.get(`${m[1]}#${m[2]}`);
        if (!i) return json(404, { message: 'Not Found' });
        if (req.method === 'PATCH') {
          for (const k of ['title', 'body', 'state', 'labels']) if (body[k] !== undefined) i[k] = body[k];
          touch(i);
        }
        return json(200, view(m[1], i));
      }
      if (u.pathname === '/api/v3/search/issues') {
        // The qualifiers Freero's checks use: repo:, is:open / is:closed, label:x or label:"x y"; the rest is words in the title.
        const q = u.searchParams.get('q') ?? '';
        const repo = /repo:([\w.-]+\/[\w.-]+)/.exec(q)?.[1];
        const state = /\bis:(open|closed)\b/.exec(q)?.[1];
        const labels = [...q.matchAll(/\blabel:(?:"([^"]+)"|(\S+))/g)].map((m) => (m[1] ?? m[2]).toLowerCase());
        const words = q.replace(/\blabel:(?:"[^"]+"|\S+)/g, '').replace(/\b(repo|is):\S+/g, '').trim().toLowerCase();
        const items = [...issues]
          .filter(([k, i]) => (!repo || k.startsWith(`${repo}#`)) && (!state || i.state === state) && labels.every((l) => i.labels.some((x) => x.toLowerCase() === l)) && (!words || i.title.toLowerCase().includes(words)))
          .map(([k, i]) => view(k.split('#')[0], i));
        return json(200, { total_count: items.length, items });
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
    issue: (repo, n) => issues.get(`${repo}#${n}`) ?? null,
    /** An issue people made on GitHub (its number). The repository is added if it isn't there. */
    create(repo, { title, body = '', labels = [], state = 'open' }) {
      if (!repos.some((r) => r.full_name === repo)) repos.push({ id: repos.length + 1, full_name: repo });
      const n = (counters.get(repo) ?? 0) + 1;
      counters.set(repo, n);
      const i = { number: n, title, body, state, labels };
      touch(i);
      issues.set(`${repo}#${n}`, i);
      return n;
    },
    edit(repo, n, changes) {
      const i = issues.get(`${repo}#${n}`);
      Object.assign(i, changes);
      touch(i);
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
  console.log(`mock GitHub (Enterprise layout) on ${g.url} (token ${g.token}; repo acme/web)`);
}
