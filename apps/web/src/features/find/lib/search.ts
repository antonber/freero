// Find on board: what is searchable (every item's text through its definition's toPlainText,
// frame titles, connector labels, comments) and how matches are found, shown and replaced.
import type { BoardElement, CommentMessageRecord, CommentThreadRecord, ElementType } from '@freero/shared';
import { replaceInRichText, richTextToPlain, type Editor, type ElementPatch, type Point } from '@engine';

export const PANEL_ID = 'find.panel';

/** One searchable text on the board. */
export type Source =
  | { kind: 'element'; key: string; id: string; type: ElementType; text: string; frameTitle: string | null }
  | { kind: 'comment'; key: string; threadId: string; messageId: string; text: string; author: string; at: Point };

export interface Match {
  source: Source;
  /** Occurrences of the query in this text. */
  count: number;
  /** The text around the first occurrence, split so the occurrence can be highlighted. */
  snippet: { before: string; hit: string; after: string };
}

export interface SearchOptions {
  caseSensitive?: boolean;
}

const SNIPPET_CONTEXT = 28;

/** Plain text of an element for search: its definition's toPlainText, else its rich text field. */
export function elementText(editor: Editor, el: BoardElement): string {
  const def = editor.getDefinition(el.type);
  if (def?.toPlainText) return def.toPlainText(el as never) ?? '';
  const field = def?.textField;
  return field ? richTextToPlain(String((el as unknown as Record<string, unknown>)[field] ?? '')) : '';
}

/** Where a comment pin sits (element-pinned threads follow their element). */
function threadPoint(t: CommentThreadRecord, el: BoardElement | undefined): Point {
  if (!t.elementId) return { x: t.x, y: t.y };
  if (!el) return t.origin ?? { x: t.x, y: t.y };
  if (t.corner === 'top-right') return { x: el.x + el.w, y: el.y };
  return { x: el.x + t.x, y: el.y + t.y };
}

/** Comment messages that still exist (no tombstone on them or their thread), with their pin. */
export function commentSources(entries: Array<[string, unknown]>, getElement: (id: string) => BoardElement | undefined): Source[] {
  const threads = new Map<string, CommentThreadRecord>();
  const deleted = new Set<string>();
  const messages: CommentMessageRecord[] = [];
  for (const [key, v] of entries) {
    const rec = v as { kind?: string } | null;
    if (!rec || typeof rec !== 'object') continue;
    if (rec.kind === 'thread') threads.set((rec as CommentThreadRecord).id, rec as CommentThreadRecord);
    else if (rec.kind === 'message') messages.push(rec as CommentMessageRecord);
    else if (rec.kind === 'deleted') deleted.add(key.slice(2));
  }
  const out: Source[] = [];
  for (const m of messages) {
    const t = threads.get(m.threadId);
    if (!t || deleted.has(m.threadId) || deleted.has(`${m.threadId}:${m.id}`)) continue;
    out.push({
      kind: 'comment',
      key: `c:${m.threadId}:${m.id}`,
      threadId: m.threadId,
      messageId: m.id,
      text: m.text,
      author: m.authorName,
      at: threadPoint(t, t.elementId ? getElement(t.elementId) : undefined),
    });
  }
  return out;
}

/** Every searchable text on the board, in board order, comments last. */
export function boardSources(editor: Editor, elements: BoardElement[], comments: Array<[string, unknown]>): Source[] {
  const out: Source[] = [];
  for (const el of elements) {
    // Off the board (a collapsed mind-map branch) or hidden for this viewer: not findable.
    if (!editor.getBounds([el.id])) continue;
    const text = elementText(editor, el).trim();
    if (!text) continue;
    const frame = el.frameId ? editor.getElement(el.frameId) : undefined;
    out.push({
      kind: 'element',
      key: `e:${el.id}`,
      id: el.id,
      type: el.type,
      text,
      frameTitle: frame?.type === 'frame' ? frame.title || 'Untitled frame' : null,
    });
  }
  out.push(...commentSources(comments, (id) => editor.getElement(id)));
  return out;
}

/** Matches of `query` in `sources`, in source order. Whitespace-only queries match nothing. */
export function search(sources: Source[], query: string, opts: SearchOptions = {}): Match[] {
  const q = opts.caseSensitive ? query : query.toLowerCase();
  if (!q.trim()) return [];
  const out: Match[] = [];
  for (const source of sources) {
    const hay = opts.caseSensitive ? source.text : source.text.toLowerCase();
    let at = hay.indexOf(q);
    if (at < 0) continue;
    const first = at;
    let count = 0;
    while (at >= 0) {
      count++;
      at = hay.indexOf(q, at + q.length);
    }
    const flat = source.text.replace(/\s+/g, ' ');
    // Same offsets in the flattened text: whitespace runs before the hit collapse to one space.
    const start = source.text.slice(0, first).replace(/\s+/g, ' ').length;
    const hitLen = source.text.slice(first, first + q.length).replace(/\s+/g, ' ').length;
    const from = Math.max(0, start - SNIPPET_CONTEXT);
    out.push({
      source,
      count,
      snippet: {
        before: (from > 0 ? '…' : '') + flat.slice(from, start),
        hit: flat.slice(start, start + hitLen),
        after: flat.slice(start + hitLen, start + hitLen + SNIPPET_CONTEXT * 2),
      },
    });
  }
  return out;
}

const replacePlain = (s: string, find: string, replacement: string, caseSensitive: boolean) => {
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  return s.replace(re, () => replacement);
};

/**
 * The patch that replaces `find` in an element's texts: its rich text field (formatting kept),
 * a card's description, a frame's title. Null when nothing there matches (or it's locked).
 */
export function replacePatch(editor: Editor, el: BoardElement, find: string, replacement: string, opts: SearchOptions = {}): ElementPatch | null {
  if (el.locked || !find) return null;
  const rec = el as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const rich = [editor.getDefinition(el.type)?.textField, el.type === 'card' ? 'description' : undefined].filter(
    (f): f is string => !!f && typeof rec[f] === 'string',
  );
  for (const f of rich) {
    const r = replaceInRichText(rec[f] as string, find, replacement, { caseSensitive: opts.caseSensitive });
    if (r.count) patch[f] = r.html;
  }
  if (el.type === 'frame') {
    const title = replacePlain(el.title, find, replacement, !!opts.caseSensitive);
    if (title !== el.title) patch.title = title;
  }
  return Object.keys(patch).length ? (patch as ElementPatch) : null;
}

/** Replaces in every matched element as ONE undo step. Returns how many items changed. */
export function replaceAll(editor: Editor, matches: Match[], find: string, replacement: string, opts: SearchOptions = {}): number {
  const patches: Array<{ id: string; patch: ElementPatch }> = [];
  for (const m of matches) {
    if (m.source.kind !== 'element') continue;
    const el = editor.getElement(m.source.id);
    const patch = el && replacePatch(editor, el, find, replacement, opts);
    if (patch) patches.push({ id: el.id, patch });
  }
  if (!patches.length) return 0;
  editor.beginGesture();
  try {
    editor.updateMany(patches);
  } finally {
    editor.endGesture();
  }
  return patches.length;
}

/** Brings a match into view: an item fitted (never zoomed in past 100% or out of the current view's zoom needlessly), a comment pin centered. */
export function revealMatch(editor: Editor, m: Match) {
  const cam = editor.getCamera();
  if (m.source.kind === 'element') {
    editor.zoomToFit([m.source.id], { maxZoom: Math.max(1, cam.zoom), padding: 120 });
    return;
  }
  const zoom = Math.max(0.75, cam.zoom);
  const area = editor.getSafeArea();
  const p = m.source.at;
  editor.setCamera(
    { x: p.x - (area.x + area.w / 2) / zoom, y: p.y - (area.y + area.h / 2) / zoom, zoom },
    { animate: true },
  );
}
