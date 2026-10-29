// Permission-aware search (KAI-151, KAI-141): an index derived through the outbox from each board's
// saved SHARED content, queried with Postgres full-text search, and every result re-checked against
// the reader's live access before anything of it is shown.
//
// Layers: content some readers of a board can't see (private drafts, hidden frames' contents) is
// SKIPPED, not indexed per audience. The index holds exactly what every reader of the board sees,
// so the only per-reader question left is "may they see this board?" — one batched check per
// query (modules/objects, purpose 'discover'), and a snippet can never come from content the reader
// can't see. Indexing per audience (owners/editors searching hidden frames, an author their own
// drafts) would need rows per reader group and a per-row check; not worth it for content that is
// hidden on purpose. What was in the shared doc before a frame was hidden stays findable until the
// next derivation (seconds) — hiding is not retroactive anyway (ARCHITECTURE "Board layers").
import {
  formatObjectUri,
  objectPath,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  searchTerms,
  type CommentThreadRecord,
  type ObjectRef,
  type SearchHighlight,
  type SearchHit,
  type SearchResponse,
} from '@freero/shared';
import { badRequest } from '../../platform/http';
import { log } from '../../platform/log';
import { nextDeriveVersion, whileConsumerPaused, type OutboxConsumer } from '../../platform/outbox';
import { allBoardIds, BOARD_EVENTS_TOPIC, boardIdsReachableBy, boardRecords, objectKindsOf, type BoardEventRecord } from '../boards/index';
import { summarizeObjects, type Actor } from '../objects/index';
import { outlineOfView } from '../outline/index';
import { BOARD_CONTENT_TOPIC, COMMENTS_COLLECTION, storedBoardView, storedDocContent } from '../realtime/index';
import { extractDocRows, extractSearchRows, type SearchRow } from './extract';
import * as repo from './repo';

export const SEARCH_CONSUMER = 'search';
const LOCK_KEY = 7_202_611_101; // arbitrary, constant across releases

/** The rows of one board as every reader of it sees it now (empty when it is gone). */
export async function searchRowsOf(boardId: string): Promise<SearchRow[]> {
  const [record] = await boardRecords([boardId]);
  if (!record) return [];
  // A doc (KAI-162): its blocks and the comments on them; a doc withholds nothing from its readers.
  if (record.kind === 'doc') return extractDocRows(record, await storedDocContent(boardId));
  const view = await storedBoardView(boardId);
  if (!view) return extractSearchRows({ board: record, outline: null, types: new Map(), withheldThreads: new Set() });
  const types = new Map(view.elements.map(({ el }) => [el.id, el.type as string]));
  const withheldThreads = new Set<string>();
  for (const v of view.collection(COMMENTS_COLLECTION).values()) {
    const t = v as Partial<CommentThreadRecord> | null;
    if (t?.kind === 'thread' && typeof t.id === 'string' && typeof t.elementId === 'string' && t.elementId && !types.has(t.elementId)) withheldThreads.add(t.id);
  }
  const outline = await outlineOfView({ id: boardId, title: record.title }, view);
  return extractSearchRows({ board: record, outline, types, withheldThreads });
}

/** Recomputes one board's rows and stores them at `version` (an older version never replaces newer rows). Idempotent. */
export async function deriveBoardSearch(boardId: string, version: number): Promise<'replaced' | 'stale' | 'gone'> {
  return repo.replaceEntries(boardId, version, await searchRowsOf(boardId));
}

function boardOfEvent(e: { topic: string; key: string; payload: unknown }): string | null {
  if (e.topic === BOARD_CONTENT_TOPIC) return e.key.startsWith('board:') ? e.key.slice('board:'.length) : null;
  const p = e.payload as Partial<BoardEventRecord> | null;
  return typeof p?.boardId === 'string' ? p.boardId : null;
}

/** The outbox consumer: each batch re-derives the boards whose content was saved or that were renamed. */
export const searchConsumer: OutboxConsumer = {
  name: SEARCH_CONSUMER,
  topics: [BOARD_CONTENT_TOPIC, BOARD_EVENTS_TOPIC],
  lockKey: LOCK_KEY,
  batchSize: 200,
  // A burst of saves of one board (someone typing) becomes one derivation.
  wakeDelayMs: 750,
  async handle(events, { version }) {
    const boards = new Set<string>();
    for (const e of events) {
      const id = boardOfEvent(e);
      if (id) boards.add(id);
    }
    for (const id of boards) await deriveBoardSearch(id, version);
  },
};

/**
 * Re-derives one board, or every board, from saved content — repair after a restore or a change
 * to the extraction. Runs while the live consumer is paused, with a version newer than any live
 * batch so far. Returns how many boards were derived.
 */
export async function rebuildSearch(boardId?: string, progress?: (done: number, total: number) => void): Promise<number> {
  return whileConsumerPaused(SEARCH_CONSUMER, async () => {
    const version = await nextDeriveVersion();
    const ids = boardId ? [boardId] : await allBoardIds();
    let done = 0;
    for (const id of ids) {
      await deriveBoardSearch(id, version);
      if (++done % 500 === 0) progress?.(done, ids.length);
    }
    if (!boardId) log(`search: rebuilt from ${ids.length} board(s)`);
    return done;
  });
}

// ---- reading ----

export interface SearchQuery {
  q?: unknown;
  workspace?: unknown;
  board?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export interface SearchOptions {
  /**
   * Further boards to leave out, after the access check (the public API: the downloads policy and
   * the team's API switch). Gets the boards of one page; answers the ones that may be shown.
   */
  allow?: (boardIds: string[]) => Promise<Set<string>>;
}

/** The query as words for to_tsquery: each a prefix (as you type) once it has two characters. */
export function toTsQuery(terms: string[]): string {
  return terms.map((t) => (t.length >= 2 ? `'${t}':*` : `'${t}'`)).join(' & ');
}

/** Splits a snippet marked with \u0001…\u0002 into its text and the highlighted ranges. */
export function readSnippet(marked: string): { snippet: string; highlights: SearchHighlight[] } {
  let snippet = '';
  const highlights: SearchHighlight[] = [];
  let start = -1;
  for (const ch of marked) {
    if (ch === '\u0001') start = snippet.length;
    else if (ch === '\u0002') {
      if (start >= 0 && snippet.length > start) highlights.push({ start, end: snippet.length });
      start = -1;
    } else snippet += ch;
  }
  return { snippet, highlights };
}

/** The words of `text` a query's terms match (as prefixes, like the query), as highlight ranges. */
export function wordsStarting(text: string, terms: string[]): SearchHighlight[] {
  const out: SearchHighlight[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const w = m[0].toLowerCase();
    if (terms.some((t) => (t.length >= 2 ? w.startsWith(t) : w === t))) out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/**
 * Searches what `actor` may find: boards they can open now (purpose 'discover': a board reached
 * only through its link counts once they opened it), optionally of one workspace or one board.
 * Results come from the index (seconds behind the boards); access never does — each page's boards
 * are checked live, so someone who lost access sees nothing of a board on the very next query.
 */
export async function searchFor(actor: Actor, query: SearchQuery, opts: SearchOptions = {}): Promise<SearchResponse> {
  const terms = searchTerms(typeof query.q === 'string' ? query.q : '');
  const limit = query.limit === undefined ? SEARCH_DEFAULT_LIMIT : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_MAX_LIMIT) throw badRequest(`limit must be a whole number from 1 to ${SEARCH_MAX_LIMIT}`);
  const offset = query.cursor === undefined || query.cursor === null || query.cursor === '' ? 0 : Number(query.cursor);
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) throw badRequest('Invalid cursor');
  if (!terms.length) return { hits: [], nextCursor: null };

  const board = str(query.board);
  const candidates = board ? [board] : await boardIdsReachableBy(actor.userId, str(query.workspace));
  const matches = await repo.search(toTsQuery(terms), candidates, limit + 1, offset);
  const more = matches.length > limit;
  const page = matches.slice(0, limit);

  const boardIds = [...new Set(page.map((m) => m.boardId))];
  // Boards and docs (KAI-162) share the index; each is checked and addressed as what it is.
  const kinds = await objectKindsOf(boardIds);
  const containerRef = (id: string): ObjectRef => ({ type: kinds.get(id) === 'doc' ? 'doc' : 'board', id });
  const summaries = await summarizeObjects(actor, boardIds.map(containerRef), 'discover');
  const visible = boardIds.filter((id) => summaries.has(formatObjectUri(containerRef(id))));
  const allowed = opts.allow ? await opts.allow(visible) : new Set(visible);

  const hits: SearchHit[] = [];
  for (const m of page) {
    const container = containerRef(m.boardId);
    const summary = summaries.get(formatObjectUri(container));
    if (!summary || !allowed.has(m.boardId)) continue;
    const isDoc = container.type === 'doc';
    // In a doc, an item is a block: the doc's own address, opened at that block.
    const ref: ObjectRef = m.elementId && !isDoc ? { type: 'element', boardId: m.boardId, id: m.elementId } : container;
    const boardPath = objectPath(container)!;
    const path =
      m.kind === 'comment' && m.threadId
        ? `${boardPath}?thread=${encodeURIComponent(m.threadId)}`
        : isDoc && m.elementId
          ? `${boardPath}?block=${encodeURIComponent(m.elementId)}`
          : objectPath(ref)!;
    hits.push({
      kind: m.kind,
      uri: formatObjectUri(ref),
      path,
      board: { id: m.boardId, title: summary.title },
      ...(isDoc ? { objectKind: 'doc' as const } : {}),
      ...(m.elementType ? { itemType: m.elementType } : {}),
      ...(m.elementId ? { itemId: m.elementId } : {}),
      ...(m.threadId ? { threadId: m.threadId } : {}),
      // A board's own title reads as it is now, whole (the index may be seconds behind a rename).
      ...(m.kind === 'board' ? { snippet: summary.title, highlights: wordsStarting(summary.title, terms) } : readSnippet(m.snippet)),
    });
  }
  return { hits, nextCursor: more ? String(offset + limit) : null };
}
