// Docs (KAI-162): the service side of the doc app. This module owns no table: a doc is a container
// of kind 'doc' in modules/boards (workspace, project, owner, members, link, trash, moderation —
// every access rule) and its document lives in modules/realtime (rooms, persistence, history,
// fan-out), so here are only the operations that make sense for a document: create one (optionally
// from Markdown, optionally next to a board), read it as Markdown / blocks, append Markdown.
import { docToMarkdown, DOC_MAX_IMPORT_CHARS, markdownToDoc, type BoardSummary, type DocBlock } from '@freero/shared';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { boardPlace, boardSummaryFor, createBoardFor, recordBoardExport, requireBoardAccess, requireBoardDownload } from '../boards/index';
import { appendDocBlocks, initDocContent, readDocContent, type BoardActor } from '../realtime/index';
import { workspaceRole } from '../workspaces/index';

export interface CreateDocInput {
  title?: unknown;
  markdown?: unknown;
  workspaceId?: unknown;
  projectId?: unknown;
  /** A doc made on a board: where that board is, when the person may create there. */
  fromBoard?: unknown;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** Markdown from a request: a string within the import limit (undefined: none given). */
export function cleanMarkdown(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw badRequest('markdown must be a string');
  if (v.length > DOC_MAX_IMPORT_CHARS) throw badRequest(`markdown is longer than ${DOC_MAX_IMPORT_CHARS} characters`);
  return v;
}

/** A doc's title from Markdown: its first heading, else its first line. */
export function titleFromMarkdown(markdown: string): string | undefined {
  const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(markdown);
  const line = heading?.[1] ?? markdown.split('\n').find((l) => l.trim())?.trim();
  return line ? line.replace(/[*_`[\]]/g, '').slice(0, 200) || undefined : undefined;
}

/**
 * A new doc owned by `userId` (the board quota counts it), with `markdown` as its first content.
 * Placed in `workspaceId` / `projectId`, or — `fromBoard` — beside that board when the person is a
 * full member of its workspace (else in their personal workspace, like a duplicate).
 */
export async function createDoc(userId: string, input: CreateDocInput): Promise<BoardSummary> {
  const markdown = cleanMarkdown(input.markdown);
  let workspaceId = str(input.workspaceId);
  let projectId = str(input.projectId) ?? null;
  const fromBoard = str(input.fromBoard);
  if (fromBoard) {
    await requireBoardAccess(fromBoard, userId, 'viewer');
    const place = await boardPlace(fromBoard);
    const role = place ? await workspaceRole(place.workspaceId, userId) : null;
    if (place && role && role !== 'guest') {
      workspaceId = place.workspaceId;
      projectId = place.projectId;
    } else {
      workspaceId = undefined;
      projectId = null;
    }
  }
  const title = input.title ?? (markdown ? titleFromMarkdown(markdown) : undefined);
  let doc: BoardSummary;
  try {
    doc = await createBoardFor(userId, { title, description: '', workspaceId, projectId, kind: 'doc' });
  } catch (err) {
    // A board's private project the person can't create in: beside it in the workspace root.
    if (!(fromBoard && projectId && err instanceof HttpError && err.status === 403)) throw err;
    doc = await createBoardFor(userId, { title, description: '', workspaceId, projectId: null, kind: 'doc' });
  }
  if (markdown) await initDocContent(doc.id, markdownToDoc(markdown));
  return doc;
}

/** The doc as `userId` may read it: its summary, blocks and Markdown. 404 for a board or no doc. */
export async function readDoc(docId: string, userId: string): Promise<{ doc: BoardSummary; blocks: DocBlock[]; markdown: string }> {
  const doc = await boardSummaryFor(docId, userId, 'doc');
  const { blocks } = await readDocContent(docId);
  return { doc, blocks, markdown: docToMarkdown(blocks) };
}

/**
 * The doc as Markdown, for a download: the workspace's downloads policy applies (403
 * downloads_restricted, audited) and the export is recorded (doc.exported).
 */
export async function exportDocMarkdown(docId: string, userId: string, via: 'export' | 'api'): Promise<{ title: string; markdown: string }> {
  const access = await requireBoardAccess(docId, userId, 'viewer');
  if (access.kind !== 'doc') throw notFound('Doc not found');
  await requireBoardDownload(docId, userId, via);
  const { blocks } = await readDocContent(docId);
  await recordBoardExport(docId, userId, 'markdown');
  return { title: access.title, markdown: docToMarkdown(blocks) };
}

/** Appends Markdown to the end of a doc as `actor` (an owner or editor of it). */
export async function appendMarkdown(docId: string, actor: BoardActor, markdown: unknown): Promise<number> {
  const md = cleanMarkdown(markdown);
  if (!md?.trim()) throw badRequest('markdown is required');
  const access = await requireBoardAccess(docId, actor.userId, 'editor');
  if (access.kind !== 'doc') throw notFound('Doc not found');
  const blocks = markdownToDoc(md);
  await appendDocBlocks(docId, { ...actor, role: access.role }, blocks);
  return blocks.length;
}
