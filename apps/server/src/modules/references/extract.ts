// What a board's content points at (pure). Board content is untrusted: anything unreadable is
// skipped, and one board yields at most MAX_REFERENCES rows.
import {
  boardOf,
  formatObjectUri,
  objectRefsInText,
  parseObjectUri,
  TRACKER_COLLECTION,
  type BoardElement,
  type ObjectRef,
  type ReferenceKind,
} from '@freero/shared';
import { COMMENTS_COLLECTION } from '../realtime/index';

export interface ReferenceRow {
  sourceElement: string;
  /** The source item's element type, or null for a reference not on an item. */
  sourceType: string | null;
  target: string;
  targetBoard: string | null;
  kind: ReferenceKind;
}

export const MAX_REFERENCES = 2000;
const ITEM_LINK = /^#([\w-]{1,64})$/;
/** Fields that hold an address rather than prose (read on their own below). */
const ADDRESS_FIELDS = new Set(['link', 'url', 'uri', 'src', 'image', 'poster']);

/** Every string inside a value (element fields, nested rich content), depth- and size-capped. */
function stringsIn(v: unknown, out: string[], depth = 0): void {
  if (out.length > 200 || depth > 6) return;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsIn(x, out, depth + 1);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) stringsIn(x, out, depth + 1);
}

/**
 * The references of a board's content: item links (`link`: '#<id>' on this board, or another
 * board's address), smart links / link cards whose address is a Freero object ('embed'), object
 * addresses written in an item's text ('mention') and in comment messages ('comment', on the item
 * the thread is pinned to), and items linked to a tracker issue ('tracker'). A link from an item
 * to itself is not a reference.
 */
export function extractReferences(
  boardId: string,
  content: { elements: Array<{ el: BoardElement }>; collection(name: string): ReadonlyMap<string, unknown> },
  origins: readonly string[],
): ReferenceRow[] {
  const rows = new Map<string, ReferenceRow>();
  const types = new Map(content.elements.map(({ el }) => [el.id, el.type as string]));
  const add = (sourceElement: string, ref: ObjectRef | null, kind: ReferenceKind) => {
    if (!ref || rows.size >= MAX_REFERENCES) return;
    if (ref.type === 'element' && ref.boardId === boardId && ref.id === sourceElement) return;
    const target = formatObjectUri(ref);
    rows.set(`${sourceElement}\n${target}\n${kind}`, { sourceElement, sourceType: types.get(sourceElement) ?? null, target, targetBoard: boardOf(ref), kind });
  };

  for (const { el } of content.elements) {
    const e = el as unknown as Record<string, unknown>;
    if (typeof e.link === 'string') {
      const m = ITEM_LINK.exec(e.link.trim());
      add(el.id, m ? { type: 'element', boardId, id: m[1] } : parseObjectUri(e.link, origins), 'link');
    }
    for (const field of ['url', 'uri']) if (typeof e[field] === 'string') add(el.id, parseObjectUri(e[field] as string, origins), 'embed');
    const text: string[] = [];
    for (const [k, v] of Object.entries(e)) if (!ADDRESS_FIELDS.has(k)) stringsIn(v, text);
    for (const t of text) for (const ref of objectRefsInText(t, origins)) add(el.id, ref, 'mention');
  }

  // Items linked to a tracker issue (KAI-153): only while the issue's record still lists the item
  // (a copy of a linked item carries `trackerLink` but isn't linked).
  const trackers = content.collection(TRACKER_COLLECTION);
  for (const { el } of content.elements) {
    const linkId = (el as { trackerLink?: unknown }).trackerLink;
    if (typeof linkId !== 'string' || !linkId) continue;
    const rec = trackers.get(linkId) as { sources?: unknown } | undefined;
    if (Array.isArray(rec?.sources) && rec.sources.includes(el.id)) add(el.id, parseObjectUri(`freero://issue/${linkId}`), 'tracker');
  }

  const comments = content.collection(COMMENTS_COLLECTION);
  const threadElement = new Map<string, string>();
  for (const v of comments.values()) {
    const r = v as { kind?: unknown; id?: unknown; elementId?: unknown };
    if (r?.kind === 'thread' && typeof r.id === 'string') threadElement.set(r.id, typeof r.elementId === 'string' ? r.elementId : '');
  }
  for (const v of comments.values()) {
    const r = v as { kind?: unknown; threadId?: unknown; text?: unknown };
    if (r?.kind !== 'message' || typeof r.text !== 'string') continue;
    const on = typeof r.threadId === 'string' ? (threadElement.get(r.threadId) ?? '') : '';
    for (const ref of objectRefsInText(r.text, origins)) add(on, ref, 'comment');
  }
  return [...rows.values()];
}
