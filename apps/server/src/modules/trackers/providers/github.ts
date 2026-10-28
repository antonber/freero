// GitHub Issues (github.com and GitHub Enterprise Server: its API at https://<host>/api/v3) through
// the public REST API with a token (a fine-grained personal access token or an installation
// token). "Projects" are repositories (owner/name); an issue's id is "owner/name#number".
//
// Freero writes only a MANAGED SECTION of the issue body, between markers, holding the
// description it made and the links back to the board items — whatever people write outside the
// markers is never touched. Open / closed is the status (open reads as to do; a card in progress
// keeps an open issue). Assignees, due dates and estimates are not synced (GitHub doesn't expose
// the emails assignees would be matched by; milestones and Projects fields are a later step).
// Webhooks carry X-Hub-Signature-256 (HMAC-SHA256 of the body with the connection's secret).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { TRACKER_PROVIDERS, type IssueValues } from '@freero/shared';
import { trackerMessage, TrackerError, type HttpResponse } from '../http';
import type { Backlink, Credentials, ProviderConnection, RemoteIssue, TrackerProvider } from './types';

const LABEL = TRACKER_PROVIDERS.github;
export const BEGIN = '<!-- freero:begin (Freero keeps this part in sync with the board) -->';
export const END = '<!-- freero:end -->';
const LINKS_PREFIX = 'On the Freero board: ';
const REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

interface GhIssue {
  number: number;
  html_url: string;
  title?: string;
  body?: string | null;
  state?: 'open' | 'closed';
  labels?: Array<string | { name?: string }>;
  updated_at?: string;
  repository_url?: string;
  pull_request?: unknown;
}

const ok = (res: HttpResponse) => res.status >= 200 && res.status < 300;
function refused(res: HttpResponse, what: string): TrackerError {
  const said = trackerMessage(res.json);
  if (res.status === 401) return new TrackerError(`${LABEL} refused the token. Check the connection.`, 'auth', 401);
  if (res.status === 403) return new TrackerError(`${LABEL} doesn’t allow this token to ${what}${said ? ` (${said})` : ''}.`, 'refused', 403);
  if (res.status === 404) return new TrackerError(`${LABEL} couldn’t find it (${what}).`, 'not_found', 404);
  return new TrackerError(`${LABEL} refused to ${what}${said ? `: ${said}` : ` (${res.status})`}.`, 'invalid', res.status);
}

/** "owner/name#12" → its parts. */
function parseId(id: string): { repo: string; number: number } {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(id);
  if (!m) throw new TrackerError(`“${id}” is not a ${LABEL} issue.`, 'invalid', 400);
  return { repo: m[1], number: Number(m[2]) };
}

/** The managed section of a body (what Freero wrote), or the whole body when there is none. */
export function managedPart(body: string): {
  description: string;
  links: string;
} {
  const a = body.indexOf(BEGIN);
  const b = body.indexOf(END);
  const inner = a >= 0 && b > a ? body.slice(a + BEGIN.length, b) : body;
  const lines = inner.replace(/\r\n?/g, '\n').trim().split('\n');
  const at = lines.findIndex((l) => l.startsWith(LINKS_PREFIX));
  if (at < 0) return { description: lines.join('\n').trim(), links: '' };
  return {
    description: [...lines.slice(0, at), ...lines.slice(at + 1)].join('\n').trim(),
    links: lines[at],
  };
}

/** `body` with its managed section replaced (or appended): text outside the markers stays as it is. */
export function withManagedPart(body: string, description: string, links: string): string {
  const section = `${BEGIN}\n${[description.trim(), links].filter(Boolean).join('\n\n')}\n${END}`;
  const a = body.indexOf(BEGIN);
  const b = body.indexOf(END);
  if (a >= 0 && b > a) return body.slice(0, a) + section + body.slice(b + END.length);
  return body.trim() ? `${body.trimEnd()}\n\n${section}` : section;
}

function toRemote(repo: string, i: GhIssue): RemoteIssue {
  return {
    id: `${repo}#${i.number}`,
    key: `${repo}#${i.number}`,
    url: i.html_url,
    values: {
      title: i.title ?? '',
      description: managedPart(i.body ?? '').description,
      status: i.state === 'closed' ? 'done' : 'todo',
      statusName: i.state === 'closed' ? 'Closed' : 'Open',
      labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
    },
    assigneeName: null,
    updatedAt: i.updated_at ? Date.parse(i.updated_at) || 0 : 0,
  };
}

async function rawIssue(conn: ProviderConnection, id: string): Promise<{ repo: string; issue: GhIssue } | null> {
  const { repo, number } = parseId(id);
  const res = await conn.call({
    method: 'GET',
    path: `/repos/${repo}/issues/${number}`,
  });
  if (res.status === 404 || res.status === 410) return null;
  if (!ok(res)) throw refused(res, 'read the issue');
  return { repo, issue: res.json as GhIssue };
}

/** The PATCH/POST body for the values present (`body` needs the current one to keep the rest). */
function bodyFor(values: IssueValues, currentBody: string | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (values.title !== undefined) out.title = values.title.trim() || 'Untitled';
  if (values.description !== undefined) {
    const cur = managedPart(currentBody ?? '');
    out.body = withManagedPart(currentBody ?? '', values.description, cur.links);
  }
  if (values.labels !== undefined) out.labels = [...new Set(values.labels.map(github.label).filter(Boolean))];
  // 'doing' has no GitHub state of its own: an open issue stays open.
  if (values.status === 'done') out.state = 'closed';
  else if (values.status === 'todo' || values.status === 'doing') out.state = 'open';
  return out;
}

const hmacOk = (secret: string, body: Buffer, given: string | undefined): boolean => {
  const m = given ? /^sha256=([0-9a-f]{64})$/i.exec(given.trim()) : null;
  if (!m) return false;
  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(m[1], 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
};

export const github: TrackerProvider = {
  kind: 'github',
  fields: ['title', 'description', 'status', 'labels'],
  queryLanguage: 'GitHub search',

  authHeaders(creds: Credentials) {
    const token = creds.kind === 'oauth' ? creds.accessToken : creds.token;
    return {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    };
  },

  async whoAmI(conn) {
    const res = await conn.call({ method: 'GET', path: '/user' });
    if (!ok(res)) throw refused(res, 'say who the token is');
    return {
      account: String((res.json as { login?: string })?.login ?? 'GitHub user'),
    };
  },

  async listProjects(conn) {
    const res = await conn.call({
      method: 'GET',
      path: '/user/repos?per_page=100&sort=updated',
    });
    if (!ok(res)) throw refused(res, 'list repositories');
    return ((res.json as Array<{ id?: number; full_name?: string; name?: string }>) ?? [])
      .filter((r) => r.full_name)
      .map((r) => ({
        id: String(r.id ?? r.full_name),
        key: r.full_name!,
        name: r.full_name!,
      }));
  },

  async getIssue(conn, id) {
    const raw = await rawIssue(conn, id);
    return raw ? toRemote(raw.repo, raw.issue) : null;
  },

  async createIssue(conn, input) {
    if (!REPO.test(input.project)) throw new TrackerError(`Name the repository as owner/name.`, 'invalid', 400);
    const notes: string[] = [];
    const body = bodyFor({ ...input.values, status: undefined }, null);
    const res = await conn.call({
      method: 'POST',
      path: `/repos/${input.project}/issues`,
      body,
    });
    if (!ok(res)) throw refused(res, `create an issue in ${input.project}`);
    let issue = toRemote(input.project, res.json as GhIssue);
    if (input.values.status === 'done') {
      const closed = await conn.call({
        method: 'PATCH',
        path: `/repos/${input.project}/issues/${(res.json as GhIssue).number}`,
        body: { state: 'closed' },
      });
      if (ok(closed)) issue = toRemote(input.project, closed.json as GhIssue);
    }
    return { issue, notes };
  },

  async updateIssue(conn, issue, patch) {
    const raw = patch.description !== undefined ? await rawIssue(conn, issue.id) : null;
    const body = bodyFor(patch, raw?.issue.body ?? null);
    if (!Object.keys(body).length) return [];
    const { repo, number } = parseId(issue.id);
    const res = await conn.call({
      method: 'PATCH',
      path: `/repos/${repo}/issues/${number}`,
      body,
    });
    if (!ok(res)) throw refused(res, `change ${issue.key}`);
    return [];
  },

  async search(conn, query, limit) {
    const q = /\bis:(issue|pr)\b/.test(query) ? query : `${query} is:issue`;
    const res = await conn.call({
      method: 'GET',
      path: `/search/issues?q=${encodeURIComponent(q)}&per_page=${Math.min(100, limit)}`,
    });
    if (res.status === 422) throw new TrackerError(`${LABEL} couldn’t run that search${trackerMessage(res.json) ? `: ${trackerMessage(res.json)}` : '.'}`, 'invalid', 422);
    if (!ok(res)) throw refused(res, 'search issues');
    const items = ((res.json as { items?: GhIssue[] })?.items ?? []).filter((i) => !i.pull_request);
    return items.slice(0, limit).flatMap((i) => {
      const m = /\/repos\/([\w.-]+\/[\w.-]+)$/.exec(i.repository_url ?? '');
      return m ? [toRemote(m[1], i)] : [];
    });
  },

  async changedSince(conn, issues, since) {
    const byRepo = new Map<string, Set<string>>();
    for (const i of issues) {
      const { repo } = parseId(i.id);
      byRepo.set(repo, (byRepo.get(repo) ?? new Set()).add(i.id));
    }
    const out: string[] = [];
    for (const [repo, ids] of byRepo) {
      const res = await conn.call({
        method: 'GET',
        path: `/repos/${repo}/issues?state=all&per_page=100&since=${encodeURIComponent(new Date(since).toISOString())}`,
      });
      if (!ok(res)) throw refused(res, 'list changed issues');
      for (const i of (res.json as GhIssue[]) ?? []) if (ids.has(`${repo}#${i.number}`)) out.push(`${repo}#${i.number}`);
    }
    return out;
  },

  async setBacklinks(conn, issue, links: Backlink[]) {
    // Every item's link lives in the managed section: rewrite that line as a whole.
    const raw = await rawIssue(conn, issue.id);
    if (!raw) throw new TrackerError(`${LABEL} couldn’t find ${issue.key}.`, 'not_found', 404);
    const body = raw.issue.body ?? '';
    const cur = managedPart(body);
    const line = links.length ? `${LINKS_PREFIX}${links.map((l, i) => `[${links.length === 1 ? 'open' : `item ${i + 1}`}](${l.url})`).join(' · ')}` : '';
    if (line === cur.links && body.includes(BEGIN)) return;
    const { repo, number } = parseId(issue.id);
    const res = await conn.call({
      method: 'PATCH',
      path: `/repos/${repo}/issues/${number}`,
      body: { body: withManagedPart(body, cur.description, line) },
    });
    if (!ok(res)) throw refused(res, `link ${issue.key} back to the board`);
  },

  label: (tag) => tag.trim().slice(0, 50),

  webhook(d) {
    const sig = d.headers['x-hub-signature-256'];
    if (!hmacOk(d.secret, d.rawBody, Array.isArray(sig) ? sig[0] : sig)) return null;
    let body: {
      issue?: { number?: number };
      repository?: { full_name?: string };
    } | null = null;
    try {
      body = JSON.parse(d.rawBody.toString('utf8'));
    } catch {
      return { issues: [] };
    }
    const n = body?.issue?.number;
    const repo = body?.repository?.full_name;
    return {
      issues: typeof n === 'number' && typeof repo === 'string' ? [`${repo}#${n}`] : [],
    };
  },
};
