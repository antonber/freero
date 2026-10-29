// Docs through the public API and MCP (KAI-162): list, create (from Markdown), read (Markdown and
// blocks, the doc's "outline") and append Markdown. A doc is a container like a board, so the same
// scopes (boards:read / boards:write), roles, the team's API switch and the downloads policy apply;
// the operations are modules/docs', the same the app uses.
import type { Request } from 'express';
import type { BoardSummary, DocBlock } from '@freero/shared';
import { badRequest } from '../../platform/http';
import { appUrl } from '../../platform/mail';
import { consumeRateLimit } from '../../platform/rateLimit';
import { useInWorkspace } from '../apiauth/index';
import { boardSummaryFor, listBoardsIn, requireBoardDownload } from '../boards/index';
import { appendMarkdown, createDoc, readDoc } from '../docs/index';
import { ensurePersonalWorkspace, workspaceRolesOf } from '../workspaces/index';
import { actingApp, apiBoard, page, withNotice, type ApiCall, type PageQuery } from './service';
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
