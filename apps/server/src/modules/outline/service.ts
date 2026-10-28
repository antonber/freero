// The board outline (KAI-166) for one caller: the board as their role sees it (realtime's
// readBoardView applies layers and hidden frames), read through the features' outline
// declarations, then scoped / paged / budgeted. The REST route, the public API (and later MCP)
// all come through here, so the downloads policy (KAI-197) is checked once, for all of them.
import {
  buildOutline,
  renderOutlineMarkdown,
  selectOutline,
  type BoardOutline,
  type OutlineItem,
  type OutlineSelection,
  type OutlineSource,
  type OutlineThread,
} from '@freero/shared';
import { getUsers } from '../auth/index';
import { requireBoardAccess, requireBoardDownload, teamAccessUserIds } from '../boards/index';
import { memberIdsOf } from '../members/index';
import { commentPeopleIn, readBoardView, type BoardView } from '../realtime/index';
import { outlineFeatures } from './features';

export interface OutlineQuery {
  format: 'json' | 'markdown';
  scope?: string;
  limit?: number;
  cursor?: string;
  budget?: number;
  authors: boolean;
  comments: boolean;
}

/** Items + edges per response when the caller sets neither a limit nor a budget. */
export const DEFAULT_LIMIT = 1000;
export const MAX_LIMIT = 5000;
export const MIN_BUDGET = 200;
export const MAX_BUDGET = 200_000;

export interface OutlineResult {
  outline: BoardOutline;
  /** The rendered Markdown (format=markdown). */
  markdown?: string;
}

/** Who reads, and through what (a refusal's audit record says which path it was). */
export interface OutlineReader {
  userId: string;
  /** 'outline': the app's route; 'api': the public API (and later MCP). */
  via: 'outline' | 'api';
}

/**
 * Display names for ids the board shows, never for an arbitrary account id someone typed into the
 * board: the owner, members, team access and people in its comments (as GET /boards/:id/people).
 */
async function namesFor(boardId: string, ownerId: string, view: BoardView, ids: Set<string>): Promise<Map<string, string>> {
  if (!ids.size) return new Map();
  const shown = new Set([ownerId, ...(await memberIdsOf(boardId)), ...(await teamAccessUserIds(boardId)), ...commentPeopleIn(view)]);
  const users = await getUsers([...ids].filter((id) => shown.has(id)));
  return new Map([...users.values()].map((u) => [u.id, u.name]));
}

/**
 * The whole outline as the reader sees it. Reading a board this way makes a machine-readable copy
 * of it, so the workspace's "downloads" policy applies (KAI-197): 403 `downloads_restricted`,
 * audited. Personal boards have no policies.
 */
async function readOutline(boardId: string, reader: OutlineReader, url: string, o: { authors: boolean; comments: boolean }, ifNoneMatch?: string) {
  const { userId } = reader;
  const { role, title, ownerId } = await requireBoardAccess(boardId, userId);
  await requireBoardDownload(boardId, userId, reader.via);
  const view = await readBoardView(boardId, { userId, role });
  if (ifNoneMatch && ifNoneMatch === view.version) return 'not-modified' as const;
  const features = await outlineFeatures();
  const source = (personName: (id: string) => string | undefined): OutlineSource => ({
    board: { id: boardId, title, url },
    version: view.version,
    readerId: userId,
    seesHidden: view.seesHidden,
    elements: view.elements,
    collection: view.collection,
    personName,
  });
  // First pass records whose names the features ask for; the second has them.
  const wanted = new Set<string>();
  buildOutline(
    source((id) => {
      wanted.add(id);
      return undefined;
    }),
    features,
    o,
  );
  const names = await namesFor(boardId, ownerId, view, wanted);
  return { outline: buildOutline(source((id) => names.get(id)), features, o), view };
}

export async function boardOutline(
  boardId: string,
  reader: OutlineReader | string,
  url: string,
  q: OutlineQuery,
  ifNoneMatch?: string,
): Promise<OutlineResult | 'not-modified'> {
  const r: OutlineReader = typeof reader === 'string' ? { userId: reader, via: 'outline' } : reader;
  const read = await readOutline(boardId, r, url, { authors: q.authors, comments: q.comments }, ifNoneMatch);
  if (read === 'not-modified') return read;
  const updated = new Map(read.view.elements.map((e) => [e.el.id, e.el.updatedAt]));
  const selection: OutlineSelection = {
    scope: q.scope,
    cursor: q.cursor,
    budget: q.budget,
    format: q.format,
    limit: q.budget === undefined && q.limit === undefined ? DEFAULT_LIMIT : q.limit,
    updatedAt: (id) => updated.get(id),
  };
  const outline = selectOutline(read.outline, selection);
  return q.format === 'markdown' ? { outline, markdown: renderOutlineMarkdown(outline, { authors: q.authors }) } : { outline };
}

/**
 * Every comment thread the reader can see, with the item it is pinned to (null: on the board, or
 * on an item they can't see) — read through the outline, so comments follow the same rules.
 */
export async function boardComments(boardId: string, reader: OutlineReader, url: string): Promise<Array<OutlineThread & { itemId: string | null }>> {
  const read = await readOutline(boardId, reader, url, { authors: false, comments: true });
  if (read === 'not-modified') return [];
  const out: Array<OutlineThread & { itemId: string | null }> = read.outline.comments.map((t) => ({ ...t, itemId: null }));
  const walk = (items: OutlineItem[]) => {
    for (const i of items) {
      for (const t of i.comments ?? []) out.push({ ...t, itemId: i.id });
      walk(i.children ?? []);
    }
  };
  walk(read.outline.items);
  return out;
}
