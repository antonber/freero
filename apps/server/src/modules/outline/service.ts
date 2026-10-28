// The board outline (KAI-166) for one caller: the board as their role sees it (realtime's
// readBoardView applies layers and hidden frames), read through the features' outline
// declarations, then scoped / paged / budgeted. The REST route, and later the public API and
// MCP, all come through `boardOutline`.
import {
  buildOutline,
  renderOutlineMarkdown,
  selectOutline,
  type BoardOutline,
  type OutlineSelection,
  type OutlineSource,
} from '@freero/shared';
import { getUsers } from '../auth/index';
import { requireBoardAccess, teamAccessUserIds } from '../boards/index';
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

export async function boardOutline(boardId: string, userId: string, url: string, q: OutlineQuery, ifNoneMatch?: string): Promise<OutlineResult | 'not-modified'> {
  const { role, title, ownerId } = await requireBoardAccess(boardId, userId);
  const view = await readBoardView(boardId, { userId, role });
  if (ifNoneMatch && ifNoneMatch === view.version) return 'not-modified';
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
    { authors: q.authors, comments: q.comments },
  );
  const names = await namesFor(boardId, ownerId, view, wanted);
  const full = buildOutline(
    source((id) => names.get(id)),
    features,
    { authors: q.authors, comments: q.comments },
  );
  const updated = new Map(view.elements.map((e) => [e.el.id, e.el.updatedAt]));
  const selection: OutlineSelection = {
    scope: q.scope,
    cursor: q.cursor,
    budget: q.budget,
    format: q.format,
    limit: q.budget === undefined && q.limit === undefined ? DEFAULT_LIMIT : q.limit,
    updatedAt: (id) => updated.get(id),
  };
  const outline = selectOutline(full, selection);
  return q.format === 'markdown' ? { outline, markdown: renderOutlineMarkdown(outline, { authors: q.authors }) } : { outline };
}
