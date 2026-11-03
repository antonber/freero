// The public REST API, /api/v1 (KAI-104; agent safety KAI-170). Reference: docs/api/openapi.json,
// which api.test.ts keeps in step with ENDPOINTS below.
//
// Every endpoint: a bearer credential (modules/apiauth — never the session cookie, so the API is
// cross-site callable and not CSRF-checked), its per-credential rate limit, the scope it needs,
// then the operation in service.ts — the SAME functions the MCP server calls — which applies the
// app's rules (board roles, workspace policies, the downloads policy, hidden frames and private
// layers through realtime's view), the team's API switch and blocks, and records one `api.call`
// audit event (who, which token or app, what, the outcome). Board text in responses is marked
// untrusted (`notice`).
import { Router, type Request, type Response } from 'express';
import { PROBLEM_REPORT_NOTICE, type ApiScope } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, HttpError } from '../../platform/http';
import { consumeRateLimit } from '../../platform/rateLimit';
import { allowCrossSiteApi } from '../../platform/security';
import { authenticate, registerProtectedResource, requireScope, sendAuthError, type ApiCredential } from '../apiauth/index';
import { isOperator } from '../auth/index';
import { parseOutlineQuery } from '../outline/index';
import { listProblems, problemDetail, problemScreenshot, sendProblemScreenshot, updateProblem } from '../problems/index';
import { backlinksForApi, resolveForApi, searchContent } from './objects';
import { appendToDoc, createDocFor, listDocs, readDocFor } from './docs';
import { getFeedback, postStatus, readStatusPost } from './controlRoom';
import { workspaceAuditFor } from './audit';
import * as api from './service';
import OPENAPI from '../../../../../docs/api/openapi.json';

export const mountPath = '/api/v1';
export const RESOURCE = '/api/v1';

type Method = 'get' | 'post' | 'patch' | 'delete';
interface Result {
  status?: number;
  body?: unknown;
  /** Sent as text/markdown instead of JSON. */
  markdown?: string;
  headers?: Record<string, string>;
  /** Writes the response itself (a file); headers above still apply. */
  send?: (res: Response) => void;
}

/** Every endpoint, with the scope it needs (null: any credential). The OpenAPI test reads this. */
export const ENDPOINTS: Array<{ method: Method; path: string; scope: ApiScope | null }> = [];

const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

export default function apiRoutes(_ctx: ServerContext): Router {
  registerProtectedResource(RESOURCE, 'Freero REST API');
  const r = Router();
  r.use(
    allowCrossSiteApi(/^\/api\/v1(\/.*)?$/, 'The public API authenticates only with bearer tokens (Authorization header), never with the session cookie', {
      methods: 'GET, POST, PATCH, DELETE, OPTIONS',
      headers: 'Authorization, Content-Type, If-None-Match',
      expose: 'ETag, Retry-After, WWW-Authenticate, X-Request-Id',
    }),
  );

  // The reference, public like the docs it is.
  r.get('/openapi.json', (_req, res) => res.json(OPENAPI));

  /** `operator`: only for Freero's operators (OPERATOR_EMAILS, verified); for anyone else the path doesn't exist (404). */
  const endpoint = (method: Method, path: string, scope: ApiScope | ((req: Request) => ApiScope) | null, fn: (call: api.ApiCall) => Promise<Result>, opts: { operator?: boolean } = {}) => {
    ENDPOINTS.push({ method, path, scope: typeof scope === 'function' ? scope({ body: {}, query: {} } as Request) : scope });
    r[method](path, (req: Request, res: Response, next) => {
      void (async () => {
        let cred: ApiCredential;
        try {
          cred = await authenticate(req, RESOURCE);
          if (opts.operator && !isOperator(cred.account)) return next(); // on to the API's 404, as for any unknown path
          await consumeRateLimit('apiCredential', `cred:${cred.credentialId}`);
          const need = typeof scope === 'function' ? scope(req) : scope;
          if (need) requireScope(req, cred, need, RESOURCE);
        } catch (e) {
          return sendAuthError(e, res, next);
        }
        const call = api.newApiCall(req, cred);
        let status = 500;
        try {
          const out = await fn(call);
          status = out.status ?? 200;
          for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
          res.setHeader('Cache-Control', 'private, no-cache');
          if (out.send) out.send(res.status(status));
          else if (status === 304) res.status(304).end();
          else if (out.markdown !== undefined) res.status(status).type('text/markdown; charset=utf-8').send(out.markdown);
          else res.status(status).json(out.body);
        } catch (e) {
          status = e instanceof HttpError ? e.status : 500;
          next(e);
        } finally {
          // Who, which credential, what, and how it ended — every call (KAI-170).
          await api.recordApiCall(call, `${method.toUpperCase()} /api/v1${path}`, status, typeof req.params.boardId === 'string' ? req.params.boardId : undefined);
        }
      })();
    });
  };

  // ---- who am I ----
  endpoint('get', '/me', null, async (call) => ({ body: api.me(call) }));

  // ---- workspaces and boards ----
  endpoint('get', '/workspaces', 'boards:read', async (call) => ({ body: await api.listWorkspaces(call) }));
  // A team workspace's audit log, for SIEMs that pull (#17; owners/admins).
  endpoint('get', '/workspaces/:workspaceId/audit', 'audit:read', async (call) => ({ body: await workspaceAuditFor(call, call.req.params.workspaceId, call.req.query) }));
  endpoint('get', '/boards', 'boards:read', async (call) => ({ body: await api.searchBoards(call, call.req.query) }));
  endpoint('post', '/boards', 'boards:write', async (call) => ({ status: 201, body: await api.createBoard(call, body(call.req)) }));
  endpoint('get', '/boards/:boardId', 'boards:read', async (call) => ({ body: await api.getBoard(call, call.req.params.boardId) }));
  endpoint('delete', '/boards/:boardId', 'boards:write', async (call) => ({ body: await api.deleteBoard(call, call.req.params.boardId, call.req.query.confirm) }));

  // ---- docs (KAI-162): containers like boards, with a document as content ----
  endpoint('get', '/docs', 'boards:read', async (call) => ({ body: await listDocs(call, call.req.query) }));
  endpoint('post', '/docs', 'boards:write', async (call) => ({ status: 201, body: await createDocFor(call, body(call.req)) }));
  endpoint('get', '/docs/:docId', 'boards:read', async (call) => {
    const out = await readDocFor(call, call.req.params.docId);
    return call.req.query.format === 'markdown' ? { markdown: out.markdown } : { body: out };
  });
  endpoint('post', '/docs/:docId/append', 'boards:write', async (call) => ({ body: await appendToDoc(call, call.req.params.docId, body(call.req)) }));

  // ---- search and object addresses (KAI-151, KAI-227): the app's rules, the API's switch and downloads policy ----
  endpoint('get', '/search', 'boards:read', async (call) => ({ body: await searchContent(call, call.req.query) }));
  endpoint('post', '/objects/resolve', 'boards:read', async (call) => ({ body: await resolveForApi(call, body(call.req).uris) }));
  endpoint('get', '/objects/backlinks', 'boards:read', async (call) => ({ body: await backlinksForApi(call, call.req.query.uri) }));

  // ---- reading a board ----
  endpoint('get', '/boards/:boardId/outline', 'boards:read', async (call) => {
    const { req } = call;
    const q = parseOutlineQuery(req);
    const etag = typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'].replace(/^W\//, '').replace(/"/g, '') : undefined;
    const result = await api.readOutline(call, req.params.boardId, q, etag);
    if (result === 'not-modified') return { status: 304 };
    const headers = { ETag: `W/"${result.outline.version}"` };
    return result.markdown !== undefined ? { headers, markdown: result.markdown } : { headers, body: api.withNotice({ outline: result.outline }) };
  });
  endpoint('get', '/boards/:boardId/items', 'boards:read', async (call) => ({ body: await api.listItems(call, call.req.params.boardId, call.req.query) }));
  endpoint('get', '/boards/:boardId/items/:itemId', 'boards:read', async (call) => ({ body: await api.getItem(call, call.req.params.boardId, call.req.params.itemId) }));

  // ---- kanbans: fields, the saved view, cards as rows (step 2e) ----
  endpoint('get', '/boards/:boardId/kanbans/:kanbanId', 'boards:read', async (call) => ({ body: await api.getKanban(call, call.req.params.boardId, call.req.params.kanbanId) }));
  endpoint('patch', '/boards/:boardId/kanbans/:kanbanId/fields', 'boards:write', async (call) => ({
    body: await api.defineFields(call, call.req.params.boardId, call.req.params.kanbanId, call.req.body),
  }));
  endpoint('patch', '/boards/:boardId/kanbans/:kanbanId/view', 'boards:write', async (call) => ({
    body: await api.configureView(call, call.req.params.boardId, call.req.params.kanbanId, call.req.body),
  }));
  // A linked view of the kanban beside it (step 3c); PATCH …/kanbans/{linkedViewId}/view configures one.
  endpoint('post', '/boards/:boardId/kanbans/:kanbanId/linked-views', 'boards:write', async (call) => ({
    status: 201,
    body: await api.addView(call, call.req.params.boardId, call.req.params.kanbanId, call.req.body),
  }));
  endpoint('get', '/boards/:boardId/kanbans/:kanbanId/cards', 'boards:read', async (call) => {
    const q = call.req.query;
    // filter: JSON; sort: "Points:desc,Title"; fields: "Priority,Points".
    let filter: unknown;
    if (typeof q.filter === 'string' && q.filter) {
      try {
        filter = JSON.parse(q.filter);
      } catch {
        throw badRequest('filter must be JSON: { "match": "all", "rules": [ { "field": "Priority", "op": "is", "value": "P1" } ] }');
      }
    }
    const sort = typeof q.sort === 'string' && q.sort ? q.sort.split(',').map((s) => ({ field: s.split(':')[0].trim(), dir: s.split(':')[1]?.trim() === 'desc' ? 'desc' : 'asc' })) : undefined;
    const fields = typeof q.fields === 'string' && q.fields ? q.fields.split(',').map((s) => s.trim()) : undefined;
    return { body: await api.queryCards(call, call.req.params.boardId, call.req.params.kanbanId, { filter, sort, fields, useView: q.useView, view: q.view, limit: q.limit, cursor: q.cursor }) };
  });

  // ---- changing items (owners and editors: the realtime write path) ----
  endpoint('post', '/boards/:boardId/items', 'boards:write', async (call) => ({ status: 201, body: await api.createItems(call, call.req.params.boardId, call.req.body) }));
  endpoint('patch', '/boards/:boardId/items/:itemId', 'boards:write', async (call) => {
    const b = call.req.body as unknown;
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw badRequest('Send the fields to change');
    const { notice, items } = await api.updateItems(call, call.req.params.boardId, [{ ...(b as Record<string, unknown>), id: call.req.params.itemId }]);
    return { body: { notice, item: items[0] } };
  });
  endpoint('delete', '/boards/:boardId/items/:itemId', 'boards:write', async (call) => ({
    body: await api.deleteItems(call, call.req.params.boardId, [call.req.params.itemId], call.req.query.confirm, false),
  }));
  endpoint('post', '/boards/:boardId/items/delete', 'boards:write', async (call) => {
    const b = body(call.req) as { ids?: unknown; confirm?: unknown };
    if (!Array.isArray(b.ids) || !b.ids.length || b.ids.some((i) => typeof i !== 'string')) throw badRequest('Send { ids: [ … ], confirm: true }');
    return { body: await api.deleteItems(call, call.req.params.boardId, [...new Set(b.ids as string[])], b.confirm, true) };
  });

  // Layout from structure: the caller says what, Freero places it (preview writes nothing;
  // suggestions proposes it for people to accept, KAI-169).
  const STRUCTURE_SCOPE: Record<string, ApiScope> = { preview: 'boards:read', suggestions: 'boards:suggest' };
  endpoint(
    'post',
    '/boards/:boardId/structure',
    (req) => STRUCTURE_SCOPE[String((req.body as { target?: unknown } | undefined)?.target)] ?? 'boards:write',
    async (call) => {
      const result = await api.insertStructureFor(call, call.req.params.boardId, call.req.body);
      return { status: result.target === 'preview' ? 200 : 201, body: result };
    },
  );

  // ---- suggestions (KAI-169): propose with boards:suggest, read with boards:read, decide with boards:write ----
  endpoint('get', '/boards/:boardId/suggestions', 'boards:read', async (call) => ({
    body: await api.listSuggestions(call, call.req.params.boardId, { groupId: call.req.query.groupId }),
  }));
  endpoint('post', '/boards/:boardId/suggestions', 'boards:suggest', async (call) => ({ status: 201, body: await api.proposeChanges(call, call.req.params.boardId, call.req.body) }));
  for (const status of ['accepted', 'rejected'] as const)
    endpoint('post', `/boards/:boardId/suggestions/${status === 'accepted' ? 'accept' : 'reject'}`, 'boards:write', async (call) => {
      const out = await api.decideSuggestions(call, call.req.params.boardId, status, call.req.body);
      return 'stale' in out ? { status: 409, body: out } : { body: out };
    });

  // ---- control rooms (KAI-172, KAI-249): an agent's lane, as the MCP tools post_status / get_feedback ----
  endpoint('post', '/boards/:boardId/control-room', 'boards:write', async (call) => ({
    body: api.withNotice(await postStatus(call, { ...readStatusPost(call.req.body), boardId: call.req.params.boardId })),
  }));
  endpoint('get', '/boards/:boardId/control-room', 'boards:read', async (call) => {
    const q = call.req.query;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    return { body: api.withNotice(await getFeedback(call, call.req.params.boardId, str(q.cursor), str(q.agent)?.slice(0, 80))) };
  });

  // ---- issue trackers (#83): which connections (and projects) this person may use on the board ----
  endpoint('get', '/boards/:boardId/trackers', 'boards:read', async (call) => ({
    body: await api.trackerConnections(call, call.req.params.boardId, typeof call.req.query.connection === 'string' ? call.req.query.connection : undefined),
  }));

  // ---- issue trackers (#79): a tracker query as linked cards (or, with target 'suggestions', proposed) ----
  endpoint(
    'post',
    '/boards/:boardId/trackers/import',
    (req) => ((req.body as { target?: unknown } | undefined)?.target === 'suggestions' ? 'boards:suggest' : 'boards:write'),
    async (call) => {
      const out = await api.importFromTracker(call, call.req.params.boardId, body(call.req));
      return { status: out.cards.length ? 201 : 200, body: out };
    },
  );

  // ---- issue trackers (#84): items sent as one issue (or one each), linked both ways — MCP sync_to_tracker ----
  endpoint('post', '/boards/:boardId/trackers/send', 'boards:write', async (call) => ({
    status: 201,
    body: await api.syncToTracker(call, call.req.params.boardId, body(call.req)),
  }));

  // ---- comments ----
  endpoint('get', '/boards/:boardId/comments', 'boards:read', async (call) => ({ body: await api.listComments(call, call.req.params.boardId) }));
  endpoint('post', '/boards/:boardId/comments', 'comments:write', async (call) => ({ status: 201, body: await api.addComment(call, call.req.params.boardId, body(call.req)) }));
  endpoint('post', '/boards/:boardId/comments/:threadId/replies', 'comments:write', async (call) => ({
    status: 201,
    body: await api.replyToComment(call, call.req.params.boardId, call.req.params.threadId, body(call.req)),
  }));

  // ---- members ----
  endpoint('get', '/boards/:boardId/members', 'members:read', async (call) => ({ body: await api.listMembers(call, call.req.params.boardId) }));
  endpoint('post', '/boards/:boardId/members', 'members:write', async (call) => ({ status: 201, body: await api.inviteMember(call, call.req.params.boardId, body(call.req)) }));
  endpoint('patch', '/boards/:boardId/members/:userId', 'members:write', async (call) => ({
    body: await api.setMemberRole(call, call.req.params.boardId, call.req.params.userId, body(call.req).role),
  }));
  endpoint('delete', '/boards/:boardId/members/:userId', 'members:write', async (call) => ({ body: await api.removeMember(call, call.req.params.boardId, call.req.params.userId) }));

  // ---- problem reports, for Freero's operators (modules/problems): a personal token with
  // problems:triage of an operator account; anyone else gets the 404 of a path that doesn't exist ----
  const triage = { operator: true };
  endpoint('get', '/operator/problems', 'problems:triage', async (call) => ({ body: { notice: PROBLEM_REPORT_NOTICE, ...(await listProblems(call.req.query)) } }), triage);
  endpoint('get', '/operator/problems/:problemId', 'problems:triage', async (call) => ({ body: { notice: PROBLEM_REPORT_NOTICE, problem: await problemDetail(call.req.params.problemId) } }), triage);
  endpoint(
    'get',
    '/operator/problems/:problemId/screenshot',
    'problems:triage',
    async (call) => {
      const file = await problemScreenshot(call.userId, call.req.params.problemId, 'api');
      return { send: (res) => sendProblemScreenshot(res, file) };
    },
    triage,
  );
  endpoint(
    'patch',
    '/operator/problems/:problemId',
    'problems:triage',
    async (call) => ({ body: { notice: PROBLEM_REPORT_NOTICE, problem: await updateProblem(call.userId, call.req.params.problemId, body(call.req), 'api') } }),
    triage,
  );

  return r;
}
