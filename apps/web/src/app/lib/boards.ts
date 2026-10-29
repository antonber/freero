// Client-side ordering/filtering of the dashboard's board collection.
import type { BoardSummary } from '@freero/shared';

/** Where a board or a doc (KAI-162) opens. */
export const objectHref = (b: Pick<BoardSummary, 'id' | 'kind'>): string => `/${b.kind === 'doc' ? 'doc' : 'board'}/${encodeURIComponent(b.id)}`;

export type BoardSort = 'opened' | 'modified' | 'name';
export type OwnerFilter = 'any' | 'me' | 'others';

export function sortBoards(boards: readonly BoardSummary[], sort: BoardSort): BoardSummary[] {
  const list = [...boards];
  switch (sort) {
    case 'opened':
      return list.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.updatedAt - a.updatedAt);
    case 'modified':
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    case 'name':
      return list.sort(
        (a, b) =>
          (a.title || 'Untitled').localeCompare(b.title || 'Untitled', undefined, { numeric: true, sensitivity: 'base' }) ||
          b.updatedAt - a.updatedAt,
      );
  }
}

export function filterByOwner(boards: readonly BoardSummary[], owner: OwnerFilter, userId: string | undefined): BoardSummary[] {
  if (owner === 'any' || !userId) return [...boards];
  return boards.filter((b) => (owner === 'me' ? b.ownerId === userId : b.ownerId !== userId));
}

/** Timestamp shown on a card for the given sort. */
export function boardTime(b: BoardSummary, sort: BoardSort): { label: string; at: number } {
  if (sort === 'opened' && b.lastOpenedAt) return { label: 'Opened', at: b.lastOpenedAt };
  return { label: 'Edited', at: b.updatedAt };
}
