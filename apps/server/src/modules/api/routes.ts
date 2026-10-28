// The public REST API, /api/v1 (KAI-104; agent safety KAI-170). Reference: docs/api/openapi.json,
// which api.test.ts keeps in step with ENDPOINTS below.
//
// Every endpoint: a bearer credential (modules/apiauth — never the session cookie, so the API is
// cross-site callable and not CSRF-checked), its per-credential rate limit, the scope it needs,
// then the SAME service functions and rules as the app (board roles, workspace policies, the
// downloads policy, hidden frames and private layers through realtime's view), the team's API
// switch and blocks for the workspace it acts in, and one `api.call` audit event (who, which
// token or app, what, the outcome). Board text in responses is marked untrusted (`notice`).
import { Router, type Request, type Response } from 'express';
import {
  CONFIRM_REQUIRED,
  OutlineSelectionError,
  tableCellEntries,
  UNTRUSTED_CONTENT_NOTICE,
  API_MAX_DELETE_PER_CALL,
  type ApiBoard,
  type ApiCommentThread,
  type ApiScope,
  type BoardSummary,
  type CommentMessageRecord,
  type CommentThreadRecord,
  type ElementDraft,
  type TableCopyContent,
} from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { appUrl } from '../../platform/mail';
import { consumeRateLimit } from '../../platform/rateLimit';
import { allowCrossSiteApi } from '../../platform/security';
import { authenticate, registerProtectedResource, requireScope, sendAuthError, useInWorkspace, type ApiCredential } from '../apiauth/index';
import { recordAuditQuietly } from '../audit/index';
import { boardSummaryFor, boardWorkspaceId, createBoardFor, listBoardsIn, requireBoardAccess, requireBoardDownload, trashBoard } from '../boards/index';
import { inviteBoardMember, listBoardMembers, removeBoardMember, setBoardMemberRole } from '../members/index';
import { boardComments, boardOutline, parseOutlineQuery } from '../outline/index';
import { BoardChangeError, changeBoard, readBoardView } from '../realtime/index';
import { insertStructure, newElementId } from '../structure/index';
import { getTemplate } from '../templates/index';
import { ensurePersonalWorkspace, getWorkspaceInfo, workspaceRolesOf } from '../workspaces/index';
import { commentSpot, patchUpdates, planCreate, planPatch, readItemInputs, toApiItem } from './items';
import OPENAPI from '../../../../../docs/api/openapi.json';

export const mountPath = '/api/v1';
export const RESOURCE = '/api/v1';

type Method = 'get' | 'post' | 'patch' | 'delete';
interface Call {
  req: Request;
  cred: ApiCredential;
  userId: string;
  /** Recorded with the call's audit event. */
  audit: { workspaceId?: string | null; target?: { type: string; id: string; label?: string | null }; metadata?: Record<string, string | number | boolean | null | string[]> };
}
interface Result {
  status?: number;
  body?: unknown;
  /** Sent as text/markdown instead of JSON. */
  markdown?: string;
  headers?: Record<string, string>;
}

/** Every endpoint, with the scope it needs (null: any credential). The OpenAPI test reads this. */
export const ENDPOINTS: Array<{ method: Method; path: string; scope: ApiScope | null }> = [];

const MAX_COMMENT = 5000;
const withNotice = <T extends object>(body: T) => ({ notice: UNTRUSTED_CONTENT_NOTICE, ...body });
const boardUrl = (req: Request, id: string) => appUrl(req, `/board/${encodeURIComponent(id)}`);

function apiBoard(req: Request, b: BoardSummary): ApiBoard {
  return {
    id: b.id,
    title: b.title,
    description: b.description,
    url: boardUrl(req, b.id),
    role: b.role,
    workspaceId: b.workspaceId,
    projectId: b.projectId,
    owner: { id: b.ownerId, name: b.ownerName },
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

/** The board as the caller sees it, after the workspace's API policy let the credential in. */
async function openBoard(call: Call, boardId: string): Promise<BoardSummary> {
  const board = await boardSummaryFor(boardId, call.userId);
  await useInWorkspace(call.cred, board.workspaceId);
  call.audit.workspaceId = board.workspaceId;
  call.audit.target = { type: 'board', id: board.id, label: board.title };
  return board;
}

function page<T>(all: T[], req: Request, dflt = 50, max = 200): { items: T[]; nextCursor: string | null } {
  const limit = req.query.limit === undefined ? dflt : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw badRequest(`limit must be a whole number from 1 to ${max}`);
  const from = req.query.cursor === undefined ? 0 : Number(req.query.cursor);
  if (!Number.isInteger(from) || from < 0) throw badRequest('Invalid cursor');
  const items = all.slice(from, from + limit);
  return { items, nextCursor: from + limit < all.length ? String(from + limit) : null };
}

const confirmed = (v: unknown) => v === true || v === 'true' || v === '1';
const requireConfirm = (v: unknown, what: string) => {
  if (!confirmed(v)) throw new HttpError(400, `${what} can’t be undone from the API: send confirm=true to go ahead`, CONFIRM_REQUIRED);
};

/** Bad input to a change, or a board that changed under it: 400, nothing written. */
async function change<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof BoardChangeError) throw badRequest(e.message);
    throw e;
  }
}

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

  const endpoint = (method: Method, path: string, scope: ApiScope | ((req: Request) => ApiScope) | null, fn: (call: Call) => Promise<Result>) => {
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
        const call: Call = { req, cred, userId: cred.account.id, audit: {} };
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
          if (call.audit.workspaceId === undefined && typeof req.params.boardId === 'string') call.audit.workspaceId = await boardWorkspaceId(req.params.boardId).catch(() => null);
          await recordAuditQuietly({
            action: 'api.call',
            ...(call.audit.workspaceId ? { workspaceId: call.audit.workspaceId } : { accountId: call.userId, fanOut: false }),
            actorId: call.userId,
            target: call.audit.target ?? (typeof req.params.boardId === 'string' ? { type: 'board', id: req.params.boardId } : null),
            metadata: {
              endpoint: `${method.toUpperCase()} /api/v1${path}`,
              status,
              credential: cred.kind === 'oauth' ? 'app' : 'token',
              credentialId: cred.credentialId,
              credentialName: cred.label,
              ...call.audit.metadata,
            },
          });
        }
      })();
    });
  };

  // ---- who am I ----
  endpoint('get', '/me', null, async ({ cred }) => ({
    body: {
      user: { id: cred.account.id, name: cred.account.name, email: cred.account.email },
      credential: { kind: cred.kind, name: cred.label, scopes: cred.scopes },
    },
  }));

  // ---- workspaces and boards ----
  endpoint('get', '/workspaces', 'boards:read', async ({ userId }) => {
    await ensurePersonalWorkspace(userId);
    const roles = await workspaceRolesOf(userId);
    const out = [];
    for (const [id, role] of roles) {
      const ws = await getWorkspaceInfo(id);
      if (ws) out.push({ id, name: ws.kind === 'personal' ? 'Personal' : ws.name, kind: ws.kind, role });
    }
    return { body: withNotice({ workspaces: out }) };
  });

  endpoint('get', '/boards', 'boards:read', async (call) => {
    const { req, userId, cred } = call;
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
    const project = typeof req.query.project === 'string' && req.query.project ? req.query.project : undefined;
    const only = typeof req.query.workspace === 'string' && req.query.workspace ? req.query.workspace : null;
    const personal = await ensurePersonalWorkspace(userId);
    const mine = await workspaceRolesOf(userId);
    // Only the caller's own workspaces are checked (and recorded) against a team's API policy.
    if (only && !mine.has(only)) throw notFound('Workspace not found');
    const workspaceIds = only ? [only] : [...mine.keys()];
    if (only) {
      await useInWorkspace(cred, only);
      call.audit.workspaceId = only === personal ? null : only;
    }
    const seen = new Map<string, BoardSummary>();
    for (const ws of workspaceIds) for (const b of await listBoardsIn(userId, ws, q, project)) seen.set(b.id, b);
    // Boards of workspaces whose API access is off, or that blocked this credential, are left out.
    const allowed = new Map<string, boolean>();
    const visible: BoardSummary[] = [];
    for (const b of [...seen.values()].sort((a, c) => c.updatedAt - a.updatedAt)) {
      if (!allowed.has(b.workspaceId))
        allowed.set(
          b.workspaceId,
          await useInWorkspace(cred, b.workspaceId).then(
            () => true,
            () => false,
          ),
        );
      if (allowed.get(b.workspaceId)) visible.push(b);
    }
    const p = page(visible, req);
    call.audit.metadata = { returned: p.items.length };
    return { body: withNotice({ boards: p.items.map((b) => apiBoard(req, b)), nextCursor: p.nextCursor }) };
  });

  endpoint('post', '/boards', 'boards:write', async (call) => {
    const { req, userId, cred } = call;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId ? body.workspaceId : await ensurePersonalWorkspace(userId);
    if (!(await workspaceRolesOf(userId)).has(workspaceId)) throw notFound('Workspace not found');
    await useInWorkspace(cred, workspaceId);
    await consumeRateLimit('boardCreate', `user:${userId}`);
    // A template is read before the board exists, so a bad id creates nothing.
    const template = typeof body.templateId === 'string' ? await getTemplate(body.templateId, userId) : null;
    if (body.templateId !== undefined && typeof body.templateId !== 'string') throw badRequest('templateId must be a template id');
    const board = await createBoardFor(userId, {
      title: body.title ?? template?.name,
      description: body.description,
      workspaceId,
      projectId: typeof body.projectId === 'string' ? body.projectId : null,
    });
    call.audit.workspaceId = board.workspaceId;
    call.audit.target = { type: 'board', id: board.id, label: board.title };
    if (template) {
      // A new, empty board: the template's elements keep their ids (references between them stay
      // intact), and table content goes where the table feature keeps it.
      const elements = template.content.elements.map(({ z: _z, createdBy: _c, createdAt: _a, updatedAt: _u, ...d }) => d as ElementDraft);
      const cells: Record<string, string> = {};
      for (const [id, content] of Object.entries(template.content.content ?? {}))
        if (elements.some((e) => e.id === id && e.type === 'table')) Object.assign(cells, tableCellEntries(id, content as TableCopyContent));
      await change(() =>
        changeBoard(board.id, { userId, role: 'owner' }, () => ({ change: { create: elements, ...(Object.keys(cells).length ? { collections: { tableCells: cells } } : {}) } })),
      );
      call.audit.metadata = { templateId: template.id, items: elements.length };
    }
    return { status: 201, body: withNotice({ board: apiBoard(req, board) }) };
  });

  endpoint('get', '/boards/:boardId', 'boards:read', async (call) => ({ body: withNotice({ board: apiBoard(call.req, await openBoard(call, call.req.params.boardId)) }) }));

  endpoint('delete', '/boards/:boardId', 'boards:write', async (call) => {
    const board = await openBoard(call, call.req.params.boardId);
    requireConfirm(call.req.query.confirm, 'Deleting a board');
    await trashBoard(board.id, call.userId);
    return { body: { ok: true, trashed: true } };
  });

  // ---- reading a board ----
  endpoint('get', '/boards/:boardId/outline', 'boards:read', async (call) => {
    const { req, userId } = call;
    const board = await openBoard(call, req.params.boardId);
    await consumeRateLimit('outline', `user:${userId}`);
    const q = parseOutlineQuery(req);
    const etag = typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'].replace(/^W\//, '').replace(/"/g, '') : undefined;
    let result;
    try {
      result = await boardOutline(board.id, { userId, via: 'api' }, boardUrl(req, board.id), q, etag);
    } catch (e) {
      if (e instanceof OutlineSelectionError) throw badRequest(e.message);
      throw e;
    }
    if (result === 'not-modified') return { status: 304 };
    const headers = { ETag: `W/"${result.outline.version}"` };
    return result.markdown !== undefined ? { headers, markdown: result.markdown } : { headers, body: withNotice({ outline: result.outline }) };
  });

  endpoint('get', '/boards/:boardId/items', 'boards:read', async (call) => {
    const { req, userId } = call;
    const board = await openBoard(call, req.params.boardId);
    await requireBoardDownload(board.id, userId, 'api');
    const type = typeof req.query.type === 'string' ? req.query.type : null;
    const view = await readBoardView(board.id, { userId, role: board.role });
    const all = view.elements
      .filter((e) => !type || e.el.type === type)
      .sort((a, b) => (a.el.z ?? 0) - (b.el.z ?? 0) || a.el.id.localeCompare(b.el.id))
      .map((e) => toApiItem(e.el, e.layer));
    const p = page(all, req, 100, 1000);
    return { body: withNotice({ items: p.items, nextCursor: p.nextCursor }) };
  });

  endpoint('get', '/boards/:boardId/items/:itemId', 'boards:read', async (call) => {
    const { req, userId } = call;
    const board = await openBoard(call, req.params.boardId);
    await requireBoardDownload(board.id, userId, 'api');
    const view = await readBoardView(board.id, { userId, role: board.role });
    const hit = view.elements.find((e) => e.el.id === req.params.itemId);
    if (!hit) throw notFound('No such item on this board');
    return { body: withNotice({ item: toApiItem(hit.el, hit.layer) }) };
  });

  // ---- changing items (owners and editors: the realtime write path) ----
  endpoint('post', '/boards/:boardId/items', 'boards:write', async (call) => {
    const { req, userId } = call;
    const inputs = readItemInputs(req.body);
    const { id, role } = await openBoard(call, req.params.boardId);
    await requireBoardAccess(id, userId, 'editor');
    const out = await change(() => changeBoard(id, { userId, role }, (view) => planCreate(inputs, view, newElementId)));
    const view = await readBoardView(id, { userId, role });
    const byId = new Map(view.elements.map((e) => [e.el.id, e]));
    call.audit.metadata = { items: out.ids.length };
    return { status: 201, body: withNotice({ items: out.ids.flatMap((i) => (byId.has(i) ? [toApiItem(byId.get(i)!.el, byId.get(i)!.layer)] : [])) }) };
  });

  endpoint('patch', '/boards/:boardId/items/:itemId', 'boards:write', async (call) => {
    const { req, userId } = call;
    const { id, role } = await openBoard(call, req.params.boardId);
    await requireBoardAccess(id, userId, 'editor');
    const itemId = req.params.itemId;
    await change(() =>
      changeBoard(id, { userId, role }, (view) => {
        const hit = view.elements.find((e) => e.el.id === itemId);
        if (!hit) throw notFound('No such item on this board');
        return { change: { update: patchUpdates(hit.el, planPatch(hit.el, req.body, view), view) } };
      }),
    );
    const hit = (await readBoardView(id, { userId, role })).elements.find((e) => e.el.id === itemId);
    call.audit.metadata = { items: 1, itemId };
    // A frame hidden from viewers stays visible to its editor; gone only if deleted meanwhile.
    if (!hit) throw notFound('No such item on this board');
    return { body: withNotice({ item: toApiItem(hit.el, hit.layer) }) };
  });

  const deleteItems = async (call: Call, ids: string[], confirm: unknown, always: boolean) => {
    const { userId } = call;
    const { id, role } = await openBoard(call, call.req.params.boardId);
    await requireBoardAccess(id, userId, 'editor');
    if (always) requireConfirm(confirm, 'Deleting several items');
    const out = await change(() =>
      changeBoard(id, { userId, role }, (view) => {
        const visible = new Set(view.elements.map((e) => e.el.id));
        const missing = ids.find((i) => !visible.has(i));
        if (missing) throw notFound(`No item ${missing} on this board`);
        const locked = view.elements.find((e) => ids.includes(e.el.id) && e.el.locked);
        if (locked) throw badRequest(`Item ${locked.el.id} is locked`);
        // Deleting what takes other items along (a frame's contents) is a bulk delete: confirm it.
        const along = view.elements.filter((e) => !ids.includes(e.el.id) && ((e.el.frameId && ids.includes(e.el.frameId)) || (e.el.attachedTo && ids.includes(e.el.attachedTo))));
        if (along.length && !always) requireConfirm(confirm, `This also deletes ${along.length} item${along.length === 1 ? '' : 's'} inside it, which`);
        return { change: { remove: ids } };
      }),
    );
    call.audit.metadata = { items: out.applied.removed.length };
    return { body: { deleted: out.applied.removed } };
  };

  endpoint('delete', '/boards/:boardId/items/:itemId', 'boards:write', (call) => deleteItems(call, [call.req.params.itemId], call.req.query.confirm, false));

  endpoint('post', '/boards/:boardId/items/delete', 'boards:write', (call) => {
    const body = (call.req.body ?? {}) as { ids?: unknown; confirm?: unknown };
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.some((i) => typeof i !== 'string')) throw badRequest('Send { ids: [ … ], confirm: true }');
    if (body.ids.length > API_MAX_DELETE_PER_CALL) throw badRequest(`At most ${API_MAX_DELETE_PER_CALL} ids per call (nothing was deleted)`);
    return deleteItems(call, [...new Set(body.ids as string[])], body.confirm, true);
  });

  // Layout from structure: the caller says what, Freero places it (preview writes nothing).
  endpoint(
    'post',
    '/boards/:boardId/structure',
    (req) => ((req.body as { target?: unknown } | undefined)?.target === 'preview' ? 'boards:read' : 'boards:write'),
    async (call) => {
      const { req, userId } = call;
      const { id } = await openBoard(call, req.params.boardId);
      await consumeRateLimit('structure', `user:${userId}`);
      const result = await insertStructure(id, userId, req.body);
      call.audit.metadata = { items: result.created.length, moved: result.moved.length, target: result.target };
      return { status: result.target === 'board' ? 201 : 200, body: result };
    },
  );

  // ---- comments ----
  endpoint('get', '/boards/:boardId/comments', 'boards:read', async (call) => {
    const { req, userId } = call;
    const board = await openBoard(call, req.params.boardId);
    const threads = await boardComments(board.id, { userId, via: 'api' }, boardUrl(req, board.id));
    const out: ApiCommentThread[] = threads.map((t) => ({
      id: t.id,
      itemId: t.itemId,
      resolved: t.resolved === true,
      messages: t.messages.map((m) => ({ id: m.id, authorId: m.authorId ?? '', author: m.author, text: m.text, at: m.at ?? 0 })),
    }));
    return { body: withNotice({ threads: out }) };
  });

  const commentText = (v: unknown) => {
    if (typeof v !== 'string' || !v.trim()) throw badRequest('text is required');
    if (v.length > MAX_COMMENT) throw badRequest(`Comments are at most ${MAX_COMMENT} characters`);
    return v;
  };
  const message = (call: Call, threadId: string, text: string): CommentMessageRecord => ({
    kind: 'message',
    threadId,
    id: newId(12),
    authorId: call.userId,
    authorName: call.cred.account.name,
    authorColor: call.cred.account.color,
    text,
    createdAt: Date.now(),
  });

  endpoint('post', '/boards/:boardId/comments', 'comments:write', async (call) => {
    const { req, userId } = call;
    const body = (req.body ?? {}) as { text?: unknown; itemId?: unknown };
    const text = commentText(body.text);
    if (body.itemId !== undefined && (typeof body.itemId !== 'string' || !body.itemId)) throw badRequest('itemId must be an item id');
    const { id, role } = await openBoard(call, req.params.boardId);
    await requireBoardAccess(id, userId, 'commenter');
    const threadId = newId(12);
    const msg = message(call, threadId, text);
    await change(() =>
      changeBoard(id, { userId, role }, (view) => {
        const item = typeof body.itemId === 'string' ? view.elements.find((e) => e.el.id === body.itemId)?.el : undefined;
        if (body.itemId !== undefined && !item) throw notFound('No such item on this board');
        const at = item ? { x: item.x + item.w, y: item.y } : commentSpot(view);
        const thread: CommentThreadRecord = item
          ? { kind: 'thread', id: threadId, x: 0, y: 0, elementId: item.id, corner: 'top-right', origin: at, createdAt: msg.createdAt, createdBy: userId }
          : { kind: 'thread', id: threadId, x: at.x, y: at.y, elementId: null, corner: null, createdAt: msg.createdAt, createdBy: userId };
        return { change: { collections: { comments: { [`t:${threadId}`]: thread, [`m:${threadId}:${msg.id}`]: msg } } } };
      }),
    );
    call.audit.metadata = { threadId };
    const thread: ApiCommentThread = {
      id: threadId,
      itemId: typeof body.itemId === 'string' ? body.itemId : null,
      resolved: false,
      messages: [{ id: msg.id, authorId: userId, author: msg.authorName, text, at: msg.createdAt }],
    };
    return { status: 201, body: withNotice({ thread }) };
  });

  endpoint('post', '/boards/:boardId/comments/:threadId/replies', 'comments:write', async (call) => {
    const { req, userId } = call;
    const text = commentText((req.body ?? {}).text);
    const { id, role } = await openBoard(call, req.params.boardId);
    await requireBoardAccess(id, userId, 'commenter');
    const threadId = req.params.threadId;
    const msg = message(call, threadId, text);
    await change(() =>
      changeBoard(id, { userId, role }, (view) => {
        const comments = view.collection('comments');
        if (!comments.has(`t:${threadId}`) || comments.has(`x:${threadId}`)) throw notFound('No such comment thread on this board');
        return { change: { collections: { comments: { [`m:${threadId}:${msg.id}`]: msg } } } };
      }),
    );
    call.audit.metadata = { threadId };
    return { status: 201, body: withNotice({ message: { id: msg.id, authorId: userId, author: msg.authorName, text, at: msg.createdAt } }) };
  });

  // ---- members ----
  endpoint('get', '/boards/:boardId/members', 'members:read', async (call) => {
    const { id } = await openBoard(call, call.req.params.boardId);
    return { body: { members: await listBoardMembers(id, call.userId) } };
  });

  endpoint('post', '/boards/:boardId/members', 'members:write', async (call) => {
    const { id } = await openBoard(call, call.req.params.boardId);
    await consumeRateLimit('invite', `user:${call.userId}`);
    const out = await inviteBoardMember(call.req, id, call.cred.account, call.req.body ?? {});
    call.audit.metadata = { role: String((call.req.body ?? {}).role ?? '') };
    return { status: 201, body: out };
  });

  endpoint('patch', '/boards/:boardId/members/:userId', 'members:write', async (call) => {
    const { id } = await openBoard(call, call.req.params.boardId);
    return { body: { member: await setBoardMemberRole(id, call.userId, call.req.params.userId, (call.req.body ?? {}).role) } };
  });

  endpoint('delete', '/boards/:boardId/members/:userId', 'members:write', async (call) => {
    const { id } = await openBoard(call, call.req.params.boardId);
    await removeBoardMember(id, call.userId, call.req.params.userId);
    return { body: { ok: true } };
  });

  return r;
}

