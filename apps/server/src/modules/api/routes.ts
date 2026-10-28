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
import type { ApiScope } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, HttpError } from '../../platform/http';
import { consumeRateLimit } from '../../platform/rateLimit';
import { allowCrossSiteApi } from '../../platform/security';
import { authenticate, registerProtectedResource, requireScope, sendAuthError, type ApiCredential } from '../apiauth/index';
import { parseOutlineQuery } from '../outline/index';
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

  const endpoint = (method: Method, path: string, scope: ApiScope | ((req: Request) => ApiScope) | null, fn: (call: api.ApiCall) => Promise<Result>) => {
    ENDPOINTS.push({ method, path, scope: typeof scope === 'function' ? scope({ body: {}, query: {} } as Request) : scope });
    r[method](path, (req: Request, res: Response, next) => {
      void (async () => {
        let cred: ApiCredential;
        try {
          cred = await authenticate(req, RESOURCE);
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
          if (status === 304) res.status(304).end();
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
  endpoint('get', '/boards', 'boards:read', async (call) => ({ body: await api.searchBoards(call, call.req.query) }));
  endpoint('post', '/boards', 'boards:write', async (call) => ({ status: 201, body: await api.createBoard(call, body(call.req)) }));
  endpoint('get', '/boards/:boardId', 'boards:read', async (call) => ({ body: await api.getBoard(call, call.req.params.boardId) }));
  endpoint('delete', '/boards/:boardId', 'boards:write', async (call) => ({ body: await api.deleteBoard(call, call.req.params.boardId, call.req.query.confirm) }));

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

  return r;
}
