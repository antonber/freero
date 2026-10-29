// ---- Search (KAI-151, KAI-141) ----
// One search over what boards SAY: titles, item text, frame titles, table cells, tags, connector
// labels and comments. The index is derived from each board's SHARED content as every reader of it
// sees it (no private drafts, nothing under a hidden frame); every query re-checks the reader's live
// access to each board, and a board reached only through its link counts once they opened it.
//
//   GET /api/search?q=&workspace=&board=&limit=&cursor=     the app (signed in)
//   GET /api/v1/search?…                                    the public API (boards:read), MCP `search`

/** What a hit is: the board itself (title / description), an item, or a comment message. */
export type SearchHitKind = 'board' | 'item' | 'comment';

export interface SearchHighlight {
  /** UTF-16 offsets into `snippet`, [start, end). */
  start: number;
  end: number;
}

export interface SearchHit {
  kind: SearchHitKind;
  /** The object it points at: freero://board/<id> or freero://board/<id>#<elementId>. */
  uri: string;
  /** Where the app opens it: /board/<id>, /board/<id>?el=<item>, /board/<id>?thread=<thread>. */
  path: string;
  /** The board (or doc) it is in. */
  board: { id: string; title: string };
  /** [additive] 'doc' when the hit is in a doc (KAI-162): `itemId` is then a block id. */
  objectKind?: 'board' | 'doc';
  /** The item's element type ('sticky', 'frame', …) for items and pinned comments. */
  itemType?: string;
  /** The item the hit is on (items; comments pinned to an item). */
  itemId?: string;
  /** The comment thread (comments). */
  threadId?: string;
  /** Plain text around the match (untrusted board text). */
  snippet: string;
  highlights: SearchHighlight[];
}

export interface SearchResponse {
  hits: SearchHit[];
  /** Pass as `cursor` for more; null at the end. */
  nextCursor: string | null;
}

/** Longest query accepted (characters). */
export const SEARCH_MAX_QUERY = 200;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;
/** Words of a query that count (the rest is ignored). */
export const SEARCH_MAX_TERMS = 8;

/**
 * The words a query searches for: letters and digits, lower-cased, at most SEARCH_MAX_TERMS.
 * Everything else (operators, quotes, punctuation) only separates words, so no input can change
 * the query's shape.
 */
export function searchTerms(q: string): string[] {
  const out: string[] = [];
  for (const m of q.slice(0, SEARCH_MAX_QUERY).toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    if (!out.includes(m[0])) out.push(m[0]);
    if (out.length >= SEARCH_MAX_TERMS) break;
  }
  return out;
}
