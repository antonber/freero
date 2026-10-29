// What a board says, as rows of the search index (pure). Input: the board's outline as EVERY reader
// sees it (outline.outlineOfView over realtime's storedBoardView: the saved shared doc, no layer,
// nothing under a hidden frame), read through the features' own outline declarations — so a table's
// cells, a kanban's column titles, a card's fields, tags and comments read here exactly as in the
// outline, and a new element type is searchable the day it gets its outline.ts.
//
// Content that some readers of the board can't see is never a row: private drafts and hidden
// frames' contents are not in the view, and a comment thread pinned to an item that is not in it
// (inside a hidden frame) is left out too — although its records sit in the shared doc's
// `comments` collection, which is not filtered per element.
import { blockText, walkDocBlocks, type BoardOutline, type CommentMessageRecord, type CommentThreadRecord, type CommentTombstone, type DocBlock, type OutlineItem, type OutlineThread, type SearchHitKind } from '@freero/shared';

export interface SearchRow {
  /** '' for the board itself, the element id for an item, 'c:<thread>:<message>' for a comment. */
  key: string;
  kind: SearchHitKind;
  elementId: string | null;
  elementType: string | null;
  threadId: string | null;
  body: string;
}

/** Most rows one board yields, and most characters one row keeps. */
export const MAX_ROWS = 5000;
export const MAX_BODY = 8000;
/** The highlight markers search snippets use; never part of indexed text. */
const MARKERS = /[\u0001\u0002]/g;

const clean = (parts: Array<string | undefined | null>): string =>
  parts
    .filter((p): p is string => typeof p === 'string' && !!p.trim())
    .join('\n')
    .replace(MARKERS, ' ')
    .slice(0, MAX_BODY);

/** A made-up node of the outline: no element has its id. */
const madeUp = (item: OutlineItem) => item.kind === 'cluster' || item.kind === 'group' || item.kind === 'column';

export interface ExtractInput {
  board: { title: string };
  /** Null: nothing was ever saved on the board (only its title is searchable). */
  outline: BoardOutline | null;
  /** Element ids → types, of every element in the view the outline was built from. */
  types: ReadonlyMap<string, string>;
  /** Comment threads pinned to an element that is NOT in the view (withheld from some readers). */
  withheldThreads: ReadonlySet<string>;
}

export function extractSearchRows({ board, outline, types, withheldThreads }: ExtractInput): SearchRow[] {
  const rows = new Map<string, SearchRow>();
  const add = (row: SearchRow) => {
    if (!row.body || rows.size >= MAX_ROWS || rows.has(row.key)) return;
    rows.set(row.key, row);
  };
  const comments = (threads: OutlineThread[] | undefined, itemId: string | null) => {
    for (const t of threads ?? []) {
      if (withheldThreads.has(t.id)) continue;
      for (const m of t.messages)
        add({
          key: `c:${t.id}:${m.id}`,
          kind: 'comment',
          elementId: itemId,
          elementType: itemId ? (types.get(itemId) ?? null) : null,
          threadId: t.id,
          body: clean([m.text]),
        });
    }
  };

  add({ key: '', kind: 'board', elementId: null, elementType: null, threadId: null, body: clean([board.title]) });

  const walk = (items: OutlineItem[]) => {
    for (const item of items) {
      if (madeUp(item)) {
        // A cluster's title is a text item the outline folded into it ('cluster:<that item's id>').
        const titled = item.kind === 'cluster' && item.title ? item.id.slice('cluster:'.length) : null;
        if (titled && types.has(titled)) add({ key: titled, kind: 'item', elementId: titled, elementType: types.get(titled)!, threadId: null, body: clean([item.title]) });
        walk(item.children ?? []);
        continue;
      }
      const fields = Object.entries(item.fields ?? {})
        .filter(([k, v]) => typeof v === 'string' && k !== 'url')
        .map(([, v]) => v as string);
      // A container's sections (kanban columns) are titled parts of it.
      const sections = (item.children ?? []).filter((c) => c.kind === 'column').map((c) => c.title);
      add({
        key: item.id,
        kind: 'item',
        elementId: item.id,
        elementType: types.get(item.id) ?? item.kind,
        threadId: null,
        body: clean([item.title, item.text, ...(item.rows ?? []).map((r) => r.join(' · ')), ...sections, ...(item.tags ?? []), ...fields]),
      });
      comments(item.comments, item.id);
      walk(item.children ?? []);
    }
  };
  if (!outline) return [...rows.values()];
  walk(outline.items);
  for (const e of outline.edges) if (e.label) add({ key: e.id, kind: 'item', elementId: e.id, elementType: types.get(e.id) ?? 'connector', threadId: null, body: clean([e.label]) });
  comments(outline.comments, null);
  return [...rows.values()];
}

/**
 * What a doc says (KAI-162): its title, each block's text (headings, paragraphs, list items, table
 * cells, image captions — a block is the doc's "item": `elementId` is its id) and its comment
 * messages, on the block their thread is on. A doc withholds nothing from its readers, so every
 * reader of it may find all of it. Deleted threads and messages are not indexed.
 */
export function extractDocRows(doc: { title: string }, content: { blocks: DocBlock[]; comments: ReadonlyMap<string, unknown> } | null): SearchRow[] {
  const rows = new Map<string, SearchRow>();
  const add = (row: SearchRow) => {
    if (!row.body || rows.size >= MAX_ROWS || rows.has(row.key)) return;
    rows.set(row.key, row);
  };
  add({ key: '', kind: 'board', elementId: null, elementType: null, threadId: null, body: clean([doc.title]) });
  if (!content) return [...rows.values()];
  for (const { block } of walkDocBlocks(content.blocks)) {
    if (typeof block.id !== 'string' || !block.id) continue;
    add({ key: block.id, kind: 'item', elementId: block.id, elementType: block.type, threadId: null, body: clean([blockText(block)]) });
  }
  const threads = new Map<string, string | null>();
  const deleted = new Set<string>();
  for (const v of content.comments.values()) {
    const r = v as Partial<CommentThreadRecord | CommentTombstone> | null;
    if (r?.kind === 'thread' && typeof r.id === 'string') threads.set(r.id, typeof r.elementId === 'string' && r.elementId ? r.elementId : null);
    else if (r?.kind === 'deleted' && typeof r.threadId === 'string') deleted.add(r.messageId ? `${r.threadId}:${r.messageId}` : r.threadId);
  }
  for (const v of content.comments.values()) {
    const m = v as Partial<CommentMessageRecord> | null;
    if (m?.kind !== 'message' || typeof m.threadId !== 'string' || typeof m.id !== 'string' || typeof m.text !== 'string') continue;
    if (!threads.has(m.threadId) || deleted.has(m.threadId) || deleted.has(`${m.threadId}:${m.id}`)) continue;
    const blockId = threads.get(m.threadId) ?? null;
    add({ key: `c:${m.threadId}:${m.id}`, kind: 'comment', elementId: blockId, elementType: null, threadId: m.threadId, body: clean([m.text]) });
  }
  return [...rows.values()];
}
