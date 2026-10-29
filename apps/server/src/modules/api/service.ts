// What the public API does for a credential (KAI-104; agent safety KAI-170; agents KAI-168), one
// function per operation. Two resource servers call these: the REST API (routes.ts, /api/v1) and
// the MCP server (modules/mcp, through index.ts) — so a rule lives here once: the board role AND
// the scope, the team's API switch and blocks, the downloads policy on reads, confirmations for
// destructive changes, the per-agent write limit, untrusted-content notices, attribution
// ("<app> for <person>") and the `api.call` audit event.
//
// The caller authenticates (apiauth.authenticate) and checks the scope; everything after that is here.
import type { Request } from 'express';
import {
  API_MAX_DELETE_PER_CALL,
  API_MAX_ITEMS_PER_CALL,
  SUGGESTION_STALE,
  type ApiSuggestionGroup,
  CONFIRM_REQUIRED,
  OutlineSelectionError,
  tableCellEntries,
  UNTRUSTED_CONTENT_NOTICE,
  type ActingApp,
  type ApiBoard,
  type ApiCommentThread,
  type ApiItem,
  type BoardSummary,
  type CommentMessageRecord,
  type CommentThreadRecord,
  type ElementDraft,
  type InsertStructureResponse,
  LayoutError,
  type Role,
  type StructurePlacement,
  type SavedTemplateSummary,
  type TableCopyContent,
} from '@freero/shared';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { appUrl } from '../../platform/mail';
import { consumeRateLimit } from '../../platform/rateLimit';
import { mintEmbedTicket, useInWorkspace, type ApiCredential } from '../apiauth/index';
import { recordAuditQuietly } from '../audit/index';
import {
  boardSummaryFor,
  boardWorkspaceId,
  createBoardFor,
  listBoardsIn,
  recordBoardExport,
  requireBoardAccess,
  requireBoardDownload,
  shareBoardByLink,
  trashBoard,
} from '../boards/index';
import { inviteBoardMember, listBoardMembers, removeBoardMember, setBoardMemberRole } from '../members/index';
import { boardComments, boardOutline, type OutlineQuery, type OutlineResult } from '../outline/index';
import {
  BoardChangeError,
  capRole,
  changeBoard,
  decideSuggestions as decide,
  proposeSuggestions,
  readBoardView,
  showAgentPresence,
  SuggestionNotFoundError,
  SuggestionStaleError,
  type BoardActor,
  type BoardView,
} from '../realtime/index';
import { insertStructure, newElementId, planMoveInto, readPlacement } from '../structure/index';
import { getTemplate, listTemplates } from '../templates/index';
import { ensurePersonalWorkspace, getWorkspaceInfo, workspaceRolesOf } from '../workspaces/index';
import { boardConnections, importCandidates, importIssues, projectsOf, sendToTracker } from '../trackers/index';
import { commentSpot, patchUpdates, planCreate, planPatch, readItemInputs, toApiItem } from './items';
import { planProposal, readProposal, suggestionGroups } from './suggestions';
import { pausedError, pauseOf } from './pause';

/** One call of a credential: who, through what, and what its audit event will say. */
export interface ApiCall {
  /** The HTTP request (links are built for the origin it came in on). */
  req: Request;
  cred: ApiCredential;
  userId: string;
  /** Recorded with the call's audit event. */
  audit: { workspaceId?: string | null; target?: { type: string; id: string; label?: string | null } | null; metadata?: Record<string, string | number | boolean | null | string[]> };
}

export const newApiCall = (req: Request, cred: ApiCredential): ApiCall => ({ req, cred, userId: cred.account.id, audit: {} });

/** Pages of a list: `cursor` is the index to start from. */
export interface PageQuery {
  limit?: unknown;
  cursor?: unknown;
}

const MAX_COMMENT = 5000;
export const withNotice = <T extends object>(body: T) => ({ notice: UNTRUSTED_CONTENT_NOTICE, ...body });
export const boardUrl = (req: Request, id: string) => appUrl(req, `/board/${encodeURIComponent(id)}`);

/** The app or token a call acts through, as the board shows it (KAI-168). */
export function actingApp(cred: ApiCredential): ActingApp {
  return cred.kind === 'oauth' ? { kind: 'app', id: cred.clientId ?? cred.credentialId, name: cred.label } : { kind: 'token', id: cred.tokenId, name: cred.label };
}

/** The writer a change is attributed to: the person, through the app or token. */
export const actorOf = (call: ApiCall, role: Role): BoardActor => ({ userId: call.userId, role, name: call.cred.account.name, via: actingApp(call.cred) });

/**
 * Before an app or token writes: on a `board` where a person paused one of its control-room lanes
 * (KAI-249, pause.ts), refused with `agent_paused`; then the per-agent write limit (KAI-168): every
 * change it makes counts against ITS budget (`RATE_LIMIT_AGENT_WRITE`), apart from the person's
 * own editing and from other apps.
 */
export async function agentWrite(call: ApiCall, board?: { id: string; role: Role }): Promise<void> {
  if (board && pauseOf(await readBoardView(board.id, { userId: call.userId, role: board.role }), actingApp(call.cred))) throw pausedError();
  await consumeRateLimit('agentWrite', `cred:${call.cred.credentialId}`);
}

export function apiBoard(req: Request, b: BoardSummary): ApiBoard {
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
export async function openBoard(call: ApiCall, boardId: string): Promise<BoardSummary> {
  // A doc (KAI-162) is no board for the board operations: 404 here, served by /docs (docs.ts).
  const board = await boardSummaryFor(boardId, call.userId, 'board');
  await useInWorkspace(call.cred, board.workspaceId);
  call.audit.workspaceId = board.workspaceId;
  call.audit.target = { type: 'board', id: board.id, label: board.title };
  return board;
}

/**
 * A live view of the board for the assistant's host to show (MCP Apps, KAI-171): a single-use
 * ticket for Freero's /embed page, acting for the person within what this credential may do
 * (apiauth embed.ts). The page, not the caller, turns it into the board.
 */
export async function openLiveView(call: ApiCall, boardId: string) {
  const board = await openBoard(call, boardId);
  const { ticket, expiresAt, maxRole } = await mintEmbedTicket(call.cred, board.id);
  const access = capRole(board.role, maxRole);
  return {
    board,
    access,
    src: appUrl(call.req, `/embed/board/${encodeURIComponent(board.id)}#ticket=${ticket}`),
    origin: new URL(appUrl(call.req, '/')).origin,
    url: boardUrl(call.req, board.id),
    expiresAt,
    // "Share with team": the link already lets people in, or this caller may turn it on.
    canShare: board.linkAccess !== 'none' || (board.role === 'owner' && call.cred.scopes.includes('boards:write')),
  };
}

/**
 * "Share with team" from a live view (KAI-171): the board's link, letting people in as at least
 * `access` (guests without an account included, as the workspace allows). A link that already
 * does is returned as it is; turning it on or up needs boards:write and the owner (the share
 * dialog's rules, its audit event).
 */
export async function shareLink(call: ApiCall, boardId: string, access: 'viewer' | 'commenter') {
  const board = await openBoard(call, boardId);
  const rank = { none: 0, viewer: 1, commenter: 2, editor: 3 } as const;
  if (rank[board.linkAccess] < rank[access]) {
    if (!call.cred.scopes.includes('boards:write'))
      throw new HttpError(403, 'Sharing the board by link needs the boards:write permission (“change boards directly”)', 'insufficient_scope');
  }
  const out = await shareBoardByLink(board.id, call.cred.account, access);
  return { url: boardUrl(call.req, board.id), linkAccess: out.linkAccess, changed: out.changed };
}

export function page<T>(all: T[], q: PageQuery, dflt = 50, max = 200): { items: T[]; nextCursor: string | null } {
  const limit = q.limit === undefined ? dflt : Number(q.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw badRequest(`limit must be a whole number from 1 to ${max}`);
  const from = q.cursor === undefined || q.cursor === null ? 0 : Number(q.cursor);
  if (!Number.isInteger(from) || from < 0) throw badRequest('Invalid cursor');
  const items = all.slice(from, from + limit);
  return { items, nextCursor: from + limit < all.length ? String(from + limit) : null };
}

const confirmed = (v: unknown) => v === true || v === 'true' || v === '1';
const requireConfirm = (v: unknown, what: string) => {
  if (!confirmed(v)) throw new HttpError(400, `${what} can’t be undone from the API: send confirm=true to go ahead`, CONFIRM_REQUIRED);
};

/** Bad input to a change, or a board that changed under it: 400, nothing written. */
export async function change<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof BoardChangeError) throw badRequest(e.message);
    throw e;
  }
}

/** Shows the app on the board for a moment, its cursor on what it just wrote (KAI-168). */
export function present(call: ApiCall, boardId: string, ids: readonly string[], view?: BoardView) {
  const at = view?.elements.find((e) => ids.includes(e.el.id))?.el;
  showAgentPresence(boardId, { via: actingApp(call.cred), user: call.cred.account, selection: ids.slice(0, 50), cursor: at ? { x: at.x + at.w / 2, y: at.y + at.h / 2 } : null });
}

/** The `api.call` audit event of a finished call: who, which credential, what, and how it ended. */
export async function recordApiCall(call: ApiCall, endpoint: string, status: number, boardId?: string): Promise<void> {
  if (call.audit.workspaceId === undefined && boardId) call.audit.workspaceId = await boardWorkspaceId(boardId).catch(() => null);
  await recordAuditQuietly({
    action: 'api.call',
    ...(call.audit.workspaceId ? { workspaceId: call.audit.workspaceId } : { accountId: call.userId, fanOut: false }),
    actorId: call.userId,
    target: call.audit.target ?? (boardId ? { type: 'board', id: boardId } : null),
    metadata: {
      endpoint,
      status,
      credential: call.cred.kind === 'oauth' ? 'app' : 'token',
      credentialId: call.cred.credentialId,
      credentialName: call.cred.label,
      ...call.audit.metadata,
    },
  });
}

// ---- who am I ----

export const me = (call: ApiCall) => ({
  user: { id: call.cred.account.id, name: call.cred.account.name, email: call.cred.account.email },
  credential: { kind: call.cred.kind, name: call.cred.label, scopes: call.cred.scopes },
});

// ---- workspaces, boards, templates ----

export async function listWorkspaces(call: ApiCall) {
  await ensurePersonalWorkspace(call.userId);
  const roles = await workspaceRolesOf(call.userId);
  const out = [];
  for (const [id, role] of roles) {
    const ws = await getWorkspaceInfo(id);
    if (ws) out.push({ id, name: ws.kind === 'personal' ? 'Personal' : ws.name, kind: ws.kind, role });
  }
  return withNotice({ workspaces: out });
}

/** Boards the caller can open (title search `q`), newest change first; workspaces that turned the API off are left out. */
export async function searchBoards(call: ApiCall, q: PageQuery & { q?: unknown; workspace?: unknown; project?: unknown }) {
  const { userId, cred } = call;
  const text = typeof q.q === 'string' ? q.q.slice(0, 200) : '';
  const project = typeof q.project === 'string' && q.project ? q.project : undefined;
  const only = typeof q.workspace === 'string' && q.workspace ? q.workspace : null;
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
  for (const ws of workspaceIds) for (const b of await listBoardsIn(userId, ws, text, project, 'board')) seen.set(b.id, b);
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
  const p = page(visible, q);
  call.audit.metadata = { returned: p.items.length };
  return withNotice({ boards: p.items.map((b) => apiBoard(call.req, b)), nextCursor: p.nextCursor });
}

/** Saved templates the caller can use (their own and their teams'). */
export async function templatesFor(call: ApiCall): Promise<{ notice: string; templates: Array<Pick<SavedTemplateSummary, 'id' | 'name' | 'description' | 'elementCount' | 'workspaceId' | 'ownerName'>> }> {
  const all = await listTemplates(call.userId);
  return withNotice({ templates: all.map((t) => ({ id: t.id, name: t.name, description: t.description, elementCount: t.elementCount, workspaceId: t.workspaceId, ownerName: t.ownerName })) });
}

export async function createBoard(call: ApiCall, body: Record<string, unknown>) {
  const { userId, cred } = call;
  const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId ? body.workspaceId : await ensurePersonalWorkspace(userId);
  if (!(await workspaceRolesOf(userId)).has(workspaceId)) throw notFound('Workspace not found');
  await useInWorkspace(cred, workspaceId);
  await consumeRateLimit('boardCreate', `user:${userId}`);
  await agentWrite(call);
  // A template is read before the board exists, so a bad id creates nothing.
  if (body.templateId !== undefined && body.templateId !== null && typeof body.templateId !== 'string') throw badRequest('templateId must be a template id');
  const template = typeof body.templateId === 'string' ? await getTemplate(body.templateId, userId) : null;
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
    const elements = template.content.elements.map(({ z: _z, createdBy: _c, createdVia: _v, createdAt: _a, updatedAt: _u, ...d }) => d as ElementDraft);
    const cells: Record<string, string> = {};
    for (const [id, content] of Object.entries(template.content.content ?? {}))
      if (elements.some((e) => e.id === id && e.type === 'table')) Object.assign(cells, tableCellEntries(id, content as TableCopyContent));
    await change(() =>
      changeBoard(board.id, actorOf(call, 'owner'), () => ({ change: { create: elements, ...(Object.keys(cells).length ? { collections: { tableCells: cells } } : {}) } })),
    );
    call.audit.metadata = { templateId: template.id, items: elements.length };
  }
  return withNotice({ board: apiBoard(call.req, board) });
}

export async function getBoard(call: ApiCall, boardId: string) {
  return withNotice({ board: apiBoard(call.req, await openBoard(call, boardId)) });
}

export async function deleteBoard(call: ApiCall, boardId: string, confirm: unknown) {
  const board = await openBoard(call, boardId);
  requireConfirm(confirm, 'Deleting a board');
  await trashBoard(board.id, call.userId);
  return { ok: true, trashed: true };
}

// ---- reading a board ----

/** The outline as the caller sees it (the downloads policy applies). 'not-modified' when `etag` still matches. */
export async function readOutline(call: ApiCall, boardId: string, q: OutlineQuery, etag?: string): Promise<OutlineResult | 'not-modified'> {
  const board = await openBoard(call, boardId);
  await consumeRateLimit('outline', `user:${call.userId}`);
  try {
    return await boardOutline(board.id, { userId: call.userId, via: 'api' }, boardUrl(call.req, board.id), q, etag);
  } catch (e) {
    if (e instanceof OutlineSelectionError) throw badRequest(e.message);
    throw e;
  }
}

/**
 * A full copy of the board's content for the caller to keep: an export, so it is refused like one
 * by the workspace's downloads policy and recorded as `board.exported` (KAI-197).
 */
export async function exportBoard(call: ApiCall, boardId: string, format: 'markdown' | 'json'): Promise<OutlineResult> {
  const board = await openBoard(call, boardId);
  await consumeRateLimit('outline', `user:${call.userId}`);
  await recordBoardExport(board.id, call.userId, format === 'json' ? 'json' : 'markdown');
  const out = await boardOutline(board.id, { userId: call.userId, via: 'api' }, boardUrl(call.req, board.id), { format, authors: true, comments: true, limit: 5000 });
  if (out === 'not-modified') throw new Error('unreachable');
  call.audit.metadata = { format };
  return out;
}

export async function listItems(call: ApiCall, boardId: string, q: PageQuery & { type?: unknown }) {
  const board = await openBoard(call, boardId);
  await requireBoardDownload(board.id, call.userId, 'api');
  const type = typeof q.type === 'string' ? q.type : null;
  const view = await readBoardView(board.id, { userId: call.userId, role: board.role });
  const all = view.elements
    .filter((e) => !type || e.el.type === type)
    .sort((a, b) => (a.el.z ?? 0) - (b.el.z ?? 0) || a.el.id.localeCompare(b.el.id))
    .map((e) => toApiItem(e.el, e.layer));
  const p = page(all, q, 100, 1000);
  return withNotice({ items: p.items, nextCursor: p.nextCursor });
}

export async function getItem(call: ApiCall, boardId: string, itemId: string) {
  const board = await openBoard(call, boardId);
  await requireBoardDownload(board.id, call.userId, 'api');
  const view = await readBoardView(board.id, { userId: call.userId, role: board.role });
  const hit = view.elements.find((e) => e.el.id === itemId);
  if (!hit) throw notFound('No such item on this board');
  return withNotice({ item: toApiItem(hit.el, hit.layer) });
}

// ---- changing items (owners and editors: the realtime write path) ----

/** Items as the caller now sees them, in the order of `ids` (gone ones left out). */
async function itemsNow(call: ApiCall, boardId: string, role: Role, ids: readonly string[]): Promise<{ items: ApiItem[]; view: BoardView }> {
  const view = await readBoardView(boardId, { userId: call.userId, role });
  const byId = new Map(view.elements.map((e) => [e.el.id, e]));
  return { items: ids.flatMap((i) => (byId.has(i) ? [toApiItem(byId.get(i)!.el, byId.get(i)!.layer)] : [])), view };
}

export async function createItems(call: ApiCall, boardId: string, body: unknown) {
  const inputs = readItemInputs(body);
  const { id, role } = await openBoard(call, boardId);
  await requireBoardAccess(id, call.userId, 'editor');
  await agentWrite(call, { id, role });
  const out = await change(() => changeBoard(id, actorOf(call, role), (view) => planCreate(inputs, view, newElementId)));
  const { items, view } = await itemsNow(call, id, role, out.ids);
  call.audit.metadata = { items: out.ids.length };
  present(call, id, out.ids, view);
  return withNotice({ items });
}

/**
 * Changes several items in ONE change (all or nothing): each `{ id, …fields }` as a PATCH of that
 * item takes it. A moved frame takes its contents along.
 */
export async function updateItems(call: ApiCall, boardId: string, patches: Array<Record<string, unknown>>) {
  if (!patches.length) throw badRequest('Nothing to change');
  if (patches.length > API_MAX_DELETE_PER_CALL) throw badRequest(`At most ${API_MAX_DELETE_PER_CALL} items per call (nothing was changed)`);
  const { id, role } = await openBoard(call, boardId);
  await requireBoardAccess(id, call.userId, 'editor');
  await agentWrite(call, { id, role });
  const ids = patches.map((p) => (typeof p.id === 'string' ? p.id : ''));
  if (new Set(ids).size !== ids.length) throw badRequest('Each item may appear once');
  // Moves by meaning: `into` a frame / kanban (column) / cluster, grouped by where they go.
  const groups = new Map<string, { placement: StructurePlacement; ids: string[] }>();
  const fieldsOf = patches.map(({ into, column, ...rest }, i) => {
    if (into === undefined && column === undefined) return rest;
    if (rest.x !== undefined || rest.y !== undefined) throw badRequest(`items[${i}]: give into (where it goes) or x / y, not both`);
    const placement = readPlacement({ into, column });
    const key = JSON.stringify(placement);
    groups.set(key, { placement, ids: [...(groups.get(key)?.ids ?? []), String(rest.id)] });
    return rest;
  });
  await change(() =>
    changeBoard(id, actorOf(call, role), (view) => {
      const moves = [...groups.values()].flatMap((g) => {
        try {
          return planMoveInto(view, g.ids, g.placement, newElementId).update;
        } catch (e) {
          if (e instanceof LayoutError) throw badRequest(e.message);
          throw e;
        }
      });
      const moved = new Map<string, Record<string, unknown>>();
      for (const m of moves) moved.set(m.id, { ...moved.get(m.id), ...m.patch });
      const update = fieldsOf.flatMap(({ id: itemId, ...fields }, i) => {
        if (!Object.keys(fields).length && moved.has(String(itemId))) return [];
        const hit = view.elements.find((e) => e.el.id === itemId);
        if (!hit && typeof itemId === 'string' && /^(cluster|group):/.test(itemId))
          throw badRequest(`${itemId} is a group the outline shows, not an item: change its items by their own ids (a cluster’s title is its first id after "cluster:")`);
        if (!hit) throw notFound(patches.length === 1 ? 'No such item on this board' : `items[${i}]: no item ${String(itemId)} on this board`);
        return patchUpdates(hit.el, planPatch(hit.el, fields, view), view);
      });
      return { change: { update: [...update, ...moves] } };
    }),
  );
  const { items, view } = await itemsNow(call, id, role, ids);
  call.audit.metadata = { items: ids.length, ...(ids.length === 1 ? { itemId: ids[0] } : {}) };
  // A frame hidden from viewers stays visible to its editor; gone only if deleted meanwhile.
  if (!items.length) throw notFound('No such item on this board');
  present(call, id, ids, view);
  return withNotice({ items });
}

/**
 * Deletes items. `bulk` (several at once) always needs `confirm`; deleting one item that takes
 * others along (a frame's contents) does too. Without it nothing changes (400 confirm_required).
 */
export async function deleteItems(call: ApiCall, boardId: string, ids: string[], confirm: unknown, bulk: boolean) {
  const { userId } = call;
  if (ids.length > API_MAX_DELETE_PER_CALL) throw badRequest(`At most ${API_MAX_DELETE_PER_CALL} ids per call (nothing was deleted)`);
  const { id, role } = await openBoard(call, boardId);
  await requireBoardAccess(id, userId, 'editor');
  if (bulk) requireConfirm(confirm, 'Deleting several items');
  await agentWrite(call, { id, role });
  const out = await change(() =>
    changeBoard(id, actorOf(call, role), (view) => {
      const visible = new Set(view.elements.map((e) => e.el.id));
      const missing = ids.find((i) => !visible.has(i));
      if (missing) throw notFound(`No item ${missing} on this board`);
      const locked = view.elements.find((e) => ids.includes(e.el.id) && e.el.locked);
      if (locked) throw badRequest(`Item ${locked.el.id} is locked`);
      // Deleting what takes other items along (a frame's contents) is a bulk delete: confirm it.
      const along = view.elements.filter((e) => !ids.includes(e.el.id) && ((e.el.frameId && ids.includes(e.el.frameId)) || (e.el.attachedTo && ids.includes(e.el.attachedTo))));
      if (along.length && !bulk) requireConfirm(confirm, `This also deletes ${along.length} item${along.length === 1 ? '' : 's'} inside it, which`);
      return { change: { remove: ids } };
    }),
  );
  call.audit.metadata = { items: out.applied.removed.length };
  return { deleted: out.applied.removed };
}

/** Layout from structure: the caller says what, Freero places it (`target: 'preview'` writes nothing). */
export async function insertStructureFor(call: ApiCall, boardId: string, body: unknown): Promise<InsertStructureResponse> {
  const { id, role } = await openBoard(call, boardId);
  await consumeRateLimit('structure', `user:${call.userId}`);
  const preview = (body as { target?: unknown } | null)?.target === 'preview';
  if (!preview) await agentWrite(call, { id, role });
  const result = await insertStructure(id, actorOf(call, role), body);
  call.audit.metadata = { items: result.created.length, moved: result.moved.length, target: result.target };
  if (result.target === 'board') present(call, id, result.created);
  return result;
}

// ---- suggestions (KAI-169): proposed changes people who can edit accept or reject ----

/** Pending suggestions, grouped as proposed (owners and editors: suggestions are theirs to review). */
export async function listSuggestions(call: ApiCall, boardId: string, q: { groupId?: unknown } = {}) {
  const board = await openBoard(call, boardId);
  await requireBoardAccess(board.id, call.userId, 'editor');
  await requireBoardDownload(board.id, call.userId, 'api');
  const groupId = typeof q.groupId === 'string' ? q.groupId : null;
  const view = await readBoardView(board.id, { userId: call.userId, role: board.role });
  const groups = suggestionGroups(view).filter((g) => !groupId || g.id === groupId);
  call.audit.metadata = { returned: groups.reduce((n, g) => n + g.suggestions.length, 0) };
  return withNotice({ groups });
}

/**
 * Proposes new items, changes and deletions instead of making them: ONE group of suggestions,
 * from "<app> for <person>". Planned exactly as createItems / updateItems / deleteItems would,
 * so accepting it later does what writing it now would have done. The board does not change.
 */
export async function proposeChanges(call: ApiCall, boardId: string, body: unknown): Promise<{ notice: string; group: ApiSuggestionGroup | null }> {
  const proposal = readProposal(body);
  const { id, role } = await openBoard(call, boardId);
  await requireBoardAccess(id, call.userId, 'editor');
  await agentWrite(call, { id, role });
  const out = await change(() => proposeSuggestions(id, actorOf(call, role), { description: proposal.description }, (view) => ({ change: planProposal(proposal, view) })));
  const groupId = out.records[0].groupId;
  call.audit.metadata = { suggestions: out.records.length, groupId };
  // Someone may have decided it already; null then.
  return withNotice({ group: suggestionGroups(await readBoardView(id, { userId: call.userId, role })).find((g) => g.id === groupId) ?? null });
}

/**
 * Accepts or rejects suggestions (`{ ids }` or `{ groupId }`; `force` to accept stale ones).
 * Accepting applies them as one change attributed to the caller (through their app). A stale one
 * changes nothing and comes back as `{ code: 'suggestion_stale', stale }` (REST: 409).
 */
export async function decideSuggestions(call: ApiCall, boardId: string, status: 'accepted' | 'rejected', body: unknown) {
  const b = (body ?? {}) as { ids?: unknown; groupId?: unknown; force?: unknown };
  const ids = b.ids;
  if (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.length > API_MAX_ITEMS_PER_CALL || ids.some((i) => typeof i !== 'string')))
    throw badRequest(`ids must be a list of 1 to ${API_MAX_ITEMS_PER_CALL} suggestion ids`);
  if (b.groupId !== undefined && typeof b.groupId !== 'string') throw badRequest('groupId must be a suggestion group id');
  if ((ids === undefined) === (b.groupId === undefined)) throw badRequest('Send { ids: [ … ] } or { groupId }');
  const { id, role } = await openBoard(call, boardId);
  await requireBoardAccess(id, call.userId, 'editor');
  if (status === 'accepted') await agentWrite(call, { id, role });
  try {
    const out = await change(() =>
      decide(id, actorOf(call, role), { ids: ids as string[] | undefined, groupId: b.groupId as string | undefined, status, force: confirmed(b.force) }),
    );
    const decided = out.records.map((r) => r.id);
    call.audit.metadata = { suggestions: decided.length, ...(out.decision.forced ? { forced: true } : {}) };
    if (status === 'rejected') return { rejected: decided };
    const a = out.applied ?? { created: [], updated: [], removed: [] };
    if (a.created.length || a.updated.length) present(call, id, [...a.created, ...a.updated]);
    return { accepted: decided, created: a.created, updated: a.updated, removed: a.removed };
  } catch (e) {
    if (e instanceof SuggestionNotFoundError) throw notFound(e.message);
    if (e instanceof SuggestionStaleError) return { error: e.message, code: SUGGESTION_STALE, stale: e.stale };
    throw e;
  }
}

// ---- comments ----

export async function listComments(call: ApiCall, boardId: string) {
  const board = await openBoard(call, boardId);
  const threads = await boardComments(board.id, { userId: call.userId, via: 'api' }, boardUrl(call.req, board.id));
  const out: ApiCommentThread[] = threads.map((t) => ({
    id: t.id,
    itemId: t.itemId,
    resolved: t.resolved === true,
    messages: t.messages.map((m) => ({ id: m.id, authorId: m.authorId ?? '', author: m.author, text: m.text, at: m.at ?? 0 })),
  }));
  return withNotice({ threads: out });
}

const commentText = (v: unknown) => {
  if (typeof v !== 'string' || !v.trim()) throw badRequest('text is required');
  if (v.length > MAX_COMMENT) throw badRequest(`Comments are at most ${MAX_COMMENT} characters`);
  return v;
};
const message = (call: ApiCall, threadId: string, text: string): CommentMessageRecord => ({
  kind: 'message',
  threadId,
  id: newId(12),
  authorId: call.userId,
  authorName: call.cred.account.name,
  authorColor: call.cred.account.color,
  text,
  createdAt: Date.now(),
});

/** A new comment thread, on the board or pinned to an item. */
export async function addComment(call: ApiCall, boardId: string, body: { text?: unknown; itemId?: unknown }) {
  const text = commentText(body.text);
  if (body.itemId !== undefined && body.itemId !== null && (typeof body.itemId !== 'string' || !body.itemId)) throw badRequest('itemId must be an item id');
  // A cluster the outline shows (`cluster:<id>`): the comment goes on its title (or first item).
  const itemId = typeof body.itemId === 'string' ? body.itemId.replace(/^cluster:/, '') : undefined;
  const { id, role } = await openBoard(call, boardId);
  await requireBoardAccess(id, call.userId, 'commenter');
  await agentWrite(call, { id, role });
  const threadId = newId(12);
  const msg = message(call, threadId, text);
  await change(() =>
    changeBoard(id, actorOf(call, role), (view) => {
      const item = itemId ? view.elements.find((e) => e.el.id === itemId)?.el : undefined;
      if (itemId && !item) throw notFound('No such item on this board');
      const at = item ? { x: item.x + item.w, y: item.y } : commentSpot(view);
      const thread: CommentThreadRecord = item
        ? { kind: 'thread', id: threadId, x: 0, y: 0, elementId: item.id, corner: 'top-right', origin: at, createdAt: msg.createdAt, createdBy: call.userId }
        : { kind: 'thread', id: threadId, x: at.x, y: at.y, elementId: null, corner: null, createdAt: msg.createdAt, createdBy: call.userId };
      return { change: { collections: { comments: { [`t:${threadId}`]: thread, [`m:${threadId}:${msg.id}`]: msg } } } };
    }),
  );
  call.audit.metadata = { threadId };
  const thread: ApiCommentThread = {
    id: threadId,
    itemId: itemId ?? null,
    resolved: false,
    messages: [{ id: msg.id, authorId: call.userId, author: msg.authorName, text, at: msg.createdAt }],
  };
  return withNotice({ thread });
}

export async function replyToComment(call: ApiCall, boardId: string, threadId: string, body: { text?: unknown }) {
  const text = commentText(body.text);
  const { id, role } = await openBoard(call, boardId);
  await requireBoardAccess(id, call.userId, 'commenter');
  await agentWrite(call, { id, role });
  const msg = message(call, threadId, text);
  await change(() =>
    changeBoard(id, actorOf(call, role), (view) => {
      const comments = view.collection('comments');
      if (!comments.has(`t:${threadId}`) || comments.has(`x:${threadId}`)) throw notFound('No such comment thread on this board');
      return { change: { collections: { comments: { [`m:${threadId}:${msg.id}`]: msg } } } };
    }),
  );
  call.audit.metadata = { threadId };
  return withNotice({ message: { id: msg.id, authorId: call.userId, author: msg.authorName, text, at: msg.createdAt } });
}

// ---- members ----

export async function listMembers(call: ApiCall, boardId: string) {
  const { id } = await openBoard(call, boardId);
  return { members: await listBoardMembers(id, call.userId) };
}

export async function inviteMember(call: ApiCall, boardId: string, body: Record<string, unknown>) {
  const { id } = await openBoard(call, boardId);
  await consumeRateLimit('invite', `user:${call.userId}`);
  const out = await inviteBoardMember(call.req, id, call.cred.account, body);
  call.audit.metadata = { role: String(body.role ?? '') };
  return out;
}

export async function setMemberRole(call: ApiCall, boardId: string, memberId: string, role: unknown) {
  const { id } = await openBoard(call, boardId);
  return { member: await setBoardMemberRole(id, call.userId, memberId, role) };
}

export async function removeMember(call: ApiCall, boardId: string, memberId: string) {
  const { id } = await openBoard(call, boardId);
  await removeBoardMember(id, call.userId, memberId);
  return { ok: true };
}

// ---- issue trackers (KAI-154) ----

/**
 * Sends items to an issue tracker as ONE issue (or one per item, `mode: 'each'`) through a
 * connection the person may use on this board (named, or the only one), linking them both ways.
 * The same operation as the board's "Send to tracker".
 */
/**
 * The tracker connection a call names (by name or id), or the only one the person may use on the
 * board. Refusals say what to do: name one of these, or connect a tracker first.
 */
async function trackerConnection(call: ApiCall, boardId: string, named: unknown) {
  const conns = await boardConnections(call.userId, boardId);
  const want = typeof named === 'string' ? named.trim().toLowerCase() : '';
  const conn = want ? conns.find((c) => c.id === named || c.name.toLowerCase() === want) : conns.length === 1 ? conns[0] : undefined;
  if (conn) return conn;
  const names = conns.map((c) => `${c.name} (${c.provider})`).join(', ');
  if (want && conns.length) throw badRequest(`No tracker connection named “${String(named).slice(0, 80)}” here; this board can use: ${names}`);
  if (conns.length) throw badRequest(`Name the tracker connection to use (connection): ${names}`);
  throw new HttpError(
    400,
    'No issue tracker is connected for this board. The person can connect their own in Freero (Settings → Your issue trackers), or a team admin can connect the team’s (Admin console → Issue trackers); then try again',
    'tracker_not_connected',
  );
}

/**
 * The issue-tracker connections the person may use on this board (#83; MCP
 * list_tracker_connections, REST `GET /boards/:id/trackers`): the team's and their own, with each
 * one's provider, default project and status — what sync_to_tracker and import_from_tracker take as
 * `connection` and `project`. With `connection`, also that connection's projects (Jira projects,
 * Linear teams, GitHub repositories), read from the tracker. Only owners and editors use trackers on
 * a board; anyone else gets an empty list and the reason.
 */
export async function trackerConnections(call: ApiCall, boardId: string, named?: unknown) {
  const { id, role } = await openBoard(call, boardId);
  if (role !== 'owner' && role !== 'editor')
    return { connections: [], note: 'Only the board’s owners and editors send items to an issue tracker or import issues; this person can’t here.' };
  const conns = await boardConnections(call.userId, id);
  const connections = conns.map((c) => ({ id: c.id, name: c.name, provider: c.provider, scope: c.scope, site: c.site, defaultProject: c.defaults.project, status: c.status }));
  if (!conns.length)
    return {
      connections,
      note: 'No issue tracker is connected for this board. The person can connect their own in Freero (Settings → Your issue trackers), or a team admin the team’s (Admin console → Issue trackers).',
    };
  if (named === undefined || named === null || named === '') return { connections };
  const conn = await trackerConnection(call, id, named);
  call.audit.metadata = { connection: conn.id, provider: conn.provider };
  const { projects } = await projectsOf(call.userId, conn.id, id);
  return { connections, projects: projects.map((p) => ({ key: p.key, name: p.name })) };
}

/**
 * Imports a tracker query as LINKED task cards (MCP import_from_tracker, REST
 * `/boards/:id/trackers/import`): the board's "Import issues…" with its rules — the person's own or
 * the team's connection, edit access, at most 100 issues, issues already linked on this board
 * skipped — placed in free space or where `placement` says, attributed to the app for the person.
 * With `target: 'suggestions'` (a connection that may only suggest) the cards are proposed instead:
 * plain cards linking to their issues, for people who can edit to accept (nothing is linked).
 */
export async function importFromTracker(call: ApiCall, boardId: string, body: Record<string, unknown>) {
  const { id, role } = await openBoard(call, boardId);
  await requireBoardAccess(id, call.userId, 'editor');
  const conn = await trackerConnection(call, id, body.connection);
  const placement = body.placement === undefined || body.placement === null ? undefined : readPlacement(body.placement);
  const req = { connectionId: conn.id, query: body.query, limit: body.limit };
  call.audit.metadata = { connection: conn.id, provider: conn.provider };
  if (body.target === 'suggestions') {
    const found = await importCandidates(call.userId, id, req);
    if (!found.issues.length) return { target: 'suggestions' as const, groupId: null, cards: [], skipped: found.skipped };
    const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim().slice(0, 500) : `Import ${found.issues.length} issue${found.issues.length === 1 ? '' : 's'} from ${conn.name}`;
    const out = await insertStructureFor(call, id, {
      structure: { kind: 'items', items: found.issues.map((i) => ({ type: 'card', text: `${i.key}: ${i.title}`, description: i.description, status: i.status, dueDate: i.dueDate, link: i.url })) },
      ...(placement ? { placement } : {}),
      target: 'suggestions',
      description,
    });
    const ids = out.parts?.[0]?.ids ?? [];
    call.audit.metadata = { ...call.audit.metadata, proposed: ids.length, skipped: found.skipped };
    return { target: 'suggestions' as const, groupId: out.groupId ?? null, cards: found.issues.map((i, n) => ({ id: ids[n], key: i.key, url: i.url })), skipped: found.skipped };
  }
  const out = await importIssues(call.userId, id, { ...req, ...(placement ? { placement } : {}) }, appUrl(call.req, ''), {
    via: actingApp(call.cred),
    preflight: () => agentWrite(call, { id, role }),
  });
  call.audit.metadata = { ...call.audit.metadata, imported: out.created.length, skipped: out.skipped };
  if (out.created.length) present(call, id, out.created);
  return { target: 'board' as const, cards: (out.cards ?? []).map(({ id: cardId, key, url }) => ({ id: cardId, key, url })), skipped: out.skipped, ...(out.containerId ? { containerId: out.containerId } : {}) };
}

export async function syncToTracker(call: ApiCall, boardId: string, body: { itemIds?: unknown; connection?: unknown; project?: unknown; issueType?: unknown; mode?: unknown }) {
  const { id, role } = await openBoard(call, boardId);
  await requireBoardAccess(id, call.userId, 'editor');
  await agentWrite(call, { id, role });
  const conn = await trackerConnection(call, id, body.connection);
  const out = await sendToTracker(call.userId, id, { connectionId: conn.id, itemIds: body.itemIds, project: body.project, issueType: body.issueType, mode: body.mode }, appUrl(call.req, ''));
  call.audit.metadata = { issues: out.issues.map((i) => i.key), items: out.issues.reduce((n, i) => n + i.itemIds.length, 0) };
  return out;
}
