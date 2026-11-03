// Docs through the public API and MCP (KAI-162): list, create (from Markdown), read (Markdown and
// blocks, the doc's "outline") and append Markdown. A doc is a container like a board, so the same
// scopes (boards:read / boards:write), roles, the team's API switch and the downloads policy apply;
// the operations are modules/docs', the same the app uses.
import type { Request } from 'express';
import { docThreads, mentionsAsNames, walkDocBlocks, type BoardSummary, type CommentMessageRecord, type CommentThreadRecord, type DocBlock } from '@freero/shared';
import { badRequest } from '../../platform/http';
import { newId } from '../../platform/ids';
import { appUrl } from '../../platform/mail';
import { consumeRateLimit } from '../../platform/rateLimit';
import { useInWorkspace } from '../apiauth/index';
import { boardSummaryFor, listBoardsIn, requireBoardAccess, requireBoardDownload } from '../boards/index';
import { getUsers } from '../auth/index';
import { appendMarkdown, createDoc, editDoc, readDoc } from '../docs/index';
import { changeBoard, readDocContent } from '../realtime/index';
import { ensurePersonalWorkspace, workspaceRolesOf } from '../workspaces/index';
import { actingApp, actorOf, apiBoard, change, page, withNotice, type ApiCall, type PageQuery } from './service';
import { notFound } from '../../platform/http';

/** A doc as the API shows it: a board's fields, with the doc page as its url. */
export function apiDoc(req: Request, d: BoardSummary) {
  return { ...apiBoard(req, d), url: appUrl(req, `/doc/${encodeURIComponent(d.id)}`) };
}

/** The doc as the caller sees it, after the workspace's API policy let the credential in. */
async function openDoc(call: ApiCall, docId: string): Promise<BoardSummary> {
  const doc = await boardSummaryFor(docId, call.userId, 'doc');
  await useInWorkspace(call.cred, doc.workspaceId);
  call.audit.workspaceId = doc.workspaceId;
  call.audit.target = { type: 'doc', id: doc.id, label: doc.title };
  return doc;
}

/** Docs the caller can open (title search `q`), newest change first; workspaces that turned the API off are left out. */
export async function listDocs(call: ApiCall, q: PageQuery & { q?: unknown; workspace?: unknown; project?: unknown }) {
  const { userId, cred } = call;
  const text = typeof q.q === 'string' ? q.q.slice(0, 200) : '';
  const project = typeof q.project === 'string' && q.project ? q.project : undefined;
  const only = typeof q.workspace === 'string' && q.workspace ? q.workspace : null;
  const mine = await workspaceRolesOf(userId);
  if (only && !mine.has(only)) throw notFound('Workspace not found');
  const seen = new Map<string, BoardSummary>();
  for (const ws of only ? [only] : [...mine.keys()]) for (const d of await listBoardsIn(userId, ws, text, project, 'doc')) seen.set(d.id, d);
  const visible: BoardSummary[] = [];
  const allowed = new Map<string, boolean>();
  for (const d of [...seen.values()].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (!allowed.has(d.workspaceId)) allowed.set(d.workspaceId, await useInWorkspace(cred, d.workspaceId).then(() => true, () => false));
    if (allowed.get(d.workspaceId)) visible.push(d);
  }
  const p = page(visible, q);
  call.audit.metadata = { returned: p.items.length };
  return withNotice({ docs: p.items.map((d) => apiDoc(call.req, d)), nextCursor: p.nextCursor });
}

/** A new doc (optionally from Markdown) in one of the caller's workspaces. */
export async function createDocFor(call: ApiCall, body: Record<string, unknown>) {
  const { userId, cred } = call;
  const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId ? body.workspaceId : await ensurePersonalWorkspace(userId);
  if (!(await workspaceRolesOf(userId)).has(workspaceId)) throw notFound('Workspace not found');
  await useInWorkspace(cred, workspaceId);
  await consumeRateLimit('boardCreate', `user:${userId}`);
  await consumeRateLimit('agentWrite', `cred:${cred.credentialId}`);
  if (body.markdown !== undefined && typeof body.markdown !== 'string') throw badRequest('markdown must be a string');
  const doc = await createDoc(userId, { title: body.title, markdown: body.markdown, workspaceId, projectId: body.projectId });
  call.audit.workspaceId = doc.workspaceId;
  call.audit.target = { type: 'doc', id: doc.id, label: doc.title };
  return withNotice({ doc: apiDoc(call.req, doc) });
}

/**
 * The doc's content: Markdown and its blocks (ids, types, text), read like an export — the
 * downloads policy of its workspace applies (403 downloads_restricted, audited).
 */
export async function readDocFor(call: ApiCall, docId: string): Promise<{ notice: string; doc: ReturnType<typeof apiDoc>; markdown: string; blocks: DocBlock[] }> {
  await openDoc(call, docId);
  await requireBoardDownload(docId, call.userId, 'api');
  const { doc, blocks, markdown } = await readDoc(docId, call.userId);
  return withNotice({ doc: apiDoc(call.req, doc), markdown, blocks });
}

/** Appends Markdown at the end of the doc (owners and editors), attributed to the app acting for the person. */
export async function appendToDoc(call: ApiCall, docId: string, body: Record<string, unknown>) {
  const doc = await openDoc(call, docId);
  await consumeRateLimit('agentWrite', `cred:${call.cred.credentialId}`);
  const added = await appendMarkdown(docId, { userId: call.userId, role: doc.role, name: call.cred.account.name, via: actingApp(call.cred) }, body.markdown);
  call.audit.metadata = { blocks: added };
  return withNotice({ ok: true as const, blocks: added });
}

/**
 * A targeted edit (#61): replace a block or the section a heading starts, insert Markdown before /
 * after a block, or delete one — by the block ids `GET /docs/{id}` answers. Owners and editors;
 * attributed to the app acting for the person, like append.
 */
export async function editDocFor(call: ApiCall, docId: string, body: Record<string, unknown>) {
  const doc = await openDoc(call, docId);
  await consumeRateLimit('agentWrite', `cred:${call.cred.credentialId}`);
  const blocks = await editDoc(docId, { userId: call.userId, role: doc.role, name: call.cred.account.name, via: actingApp(call.cred) }, body);
  call.audit.metadata = { op: String(body.op), blockId: String(body.blockId), blocks: blocks.length };
  return withNotice({ ok: true as const, blockIds: blocks });
}

// ---- comments on a doc's blocks (#61): the boards' comment records, a thread's elementId = the block ----

const MAX_COMMENT = 5000;
const commentText = (v: unknown) => {
  if (typeof v !== 'string' || !v.trim()) throw badRequest('text is required');
  if (v.length > MAX_COMMENT) throw badRequest(`Comments are at most ${MAX_COMMENT} characters`);
  return v;
};

/** A doc's comment threads (resolved ones too), oldest first, mentions as names. A read of the doc: its downloads policy applies. */
export async function listDocComments(call: ApiCall, docId: string) {
  await openDoc(call, docId);
  await requireBoardDownload(docId, call.userId, 'api');
  const { comments } = await readDocContent(docId);
  const threads = docThreads([...comments.entries()]);
  const ids = new Set<string>();
  for (const t of threads) for (const m of t.messages) for (const id of [m.authorId, ...[...m.text.matchAll(/<@([A-Za-z0-9_-]{1,64})>/g)].map((x) => x[1])]) ids.add(id);
  const users = await getUsers([...ids]);
  const name = (id: string) => users.get(id)?.name;
  call.audit.metadata = { returned: threads.length };
  return withNotice({
    threads: threads.map((t) => ({
      id: t.id,
      blockId: t.blockId,
      resolved: t.resolved,
      messages: t.messages.map((m) => ({ id: m.id, authorId: m.authorId, author: name(m.authorId) ?? m.authorName, text: mentionsAsNames(m.text, name), at: m.createdAt })),
    })),
  });
}

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

/** A new thread on a block of the doc (`blockId`), or on the doc as a whole. Commenters and up. */
export async function addDocComment(call: ApiCall, docId: string, body: { text?: unknown; blockId?: unknown }) {
  const text = commentText(body.text);
  if (body.blockId !== undefined && body.blockId !== null && (typeof body.blockId !== 'string' || !body.blockId)) throw badRequest('blockId must be a block id');
  const blockId = typeof body.blockId === 'string' ? body.blockId : null;
  const doc = await openDoc(call, docId);
  await requireBoardAccess(docId, call.userId, 'commenter');
  await consumeRateLimit('agentWrite', `cred:${call.cred.credentialId}`);
  if (blockId) {
    const { blocks } = await readDocContent(docId);
    if (![...walkDocBlocks(blocks)].some(({ block }) => block.id === blockId)) throw notFound('No such block in this doc');
  }
  const threadId = newId(12);
  const msg = message(call, threadId, text);
  const thread: CommentThreadRecord = { kind: 'thread', id: threadId, x: 0, y: 0, elementId: blockId, createdAt: msg.createdAt, createdBy: call.userId };
  await change(() => changeBoard(docId, actorOf(call, doc.role), () => ({ change: { collections: { comments: { [`t:${threadId}`]: thread, [`m:${threadId}:${msg.id}`]: msg } } } })));
  call.audit.metadata = { threadId };
  return withNotice({ thread: { id: threadId, blockId, resolved: false, messages: [{ id: msg.id, authorId: call.userId, author: msg.authorName, text, at: msg.createdAt }] } });
}

/** A reply in a thread of the doc. Commenters and up. */
export async function replyToDocComment(call: ApiCall, docId: string, threadId: string, body: { text?: unknown }) {
  const text = commentText(body.text);
  const doc = await openDoc(call, docId);
  await requireBoardAccess(docId, call.userId, 'commenter');
  await consumeRateLimit('agentWrite', `cred:${call.cred.credentialId}`);
  const msg = message(call, threadId, text);
  await change(() =>
    changeBoard(docId, actorOf(call, doc.role), (view) => {
      const comments = view.collection('comments');
      if (!comments.has(`t:${threadId}`) || comments.has(`x:${threadId}`)) throw notFound('No such comment thread in this doc');
      return { change: { collections: { comments: { [`m:${threadId}:${msg.id}`]: msg } } } };
    }),
  );
  call.audit.metadata = { threadId };
  return withNotice({ message: { id: msg.id, authorId: call.userId, author: msg.authorName, text, at: msg.createdAt } });
}
