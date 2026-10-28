// Find on board: what is searchable (every text of every item — its text field and its text
// parts such as table cells and extra connector labels — card descriptions, frame titles,
// comments) and how matches are found, shown and replaced. Texts other features own are
// rewritten through the engine (Editor.setTextParts) or the owner's command (comments).
import { mentionsAsNames, type BoardElement, type CommentMessageRecord, type CommentThreadRecord, type ElementType } from '@freero/shared';
import { replaceInRichText, richTextToPlain, type Editor, type ElementPatch, type Point, type TextPart } from '@engine';

export const PANEL_ID = 'find.panel';

/** One searchable text on the board. */
export type Source =
  | { kind: 'element'; key: string; id: string; type: ElementType; text: string; frameTitle: string | null }
  | { kind: 'comment'; key: string; threadId: string; messageId: string; text: string; author: string; authorId: string; at: Point };

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

/**
 * Plain text of an element for search, as the user reads it (formatting dropped, so "<b>Hel</b>lo"
 * is "Hello"): every text part for multi-text items (table cells, connector labels), else its
 * definition's toPlainText, else its rich text field.
 */
export function elementText(editor: Editor, el: BoardElement): string {
  const def = editor.getDefinition(el.type);
  if (def?.textParts)
    return editor
      .getTextParts(el.id)
      .map((p) => richTextToPlain(p.html).trim())
      .filter(Boolean)
      .join('\n');
  if (def?.toPlainText) return def.toPlainText(el as never, editor) ?? '';
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
export function commentSources(
  entries: Array<[string, unknown]>,
  getElement: (id: string) => BoardElement | undefined,
  /** Names for @mentions of people who haven't commented here (e.g. who is online). */
  nameOf: (userId: string) => string | undefined = () => undefined,
): Source[] {
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
  // Mentions read as the names people see ("@Ann"), not the stored <@id> tokens.
  const authors = new Map(messages.map((m) => [m.authorId, m.authorName]));
  const name = (id: string) => nameOf(id) ?? authors.get(id);
  const out: Source[] = [];
  for (const m of messages) {
    const t = threads.get(m.threadId);
    if (!t || deleted.has(m.threadId) || deleted.has(`${m.threadId}:${m.id}`)) continue;
    out.push({
      kind: 'comment',
      key: `c:${m.threadId}:${m.id}`,
      threadId: m.threadId,
      messageId: m.id,
      text: mentionsAsNames(m.text, name),
      author: m.authorName,
      authorId: m.authorId,
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
  const online = new Map(editor.getPeers().map((p) => [p.user.id, p.user.name]));
  online.set(editor.user.id, editor.user.name);
  out.push(...commentSources(comments, (id) => editor.getElement(id), (id) => online.get(id)));
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

/** What replacing in one element writes: rich texts by part (engine-routed) and plain fields. */
export interface ElementReplacement {
  id: string;
  parts: TextPart[];
  patch: ElementPatch | null;
}

/**
 * What replacing `find` in an element rewrites: every text part (its text field, table cells,
 * connector labels — formatting kept, see replaceInRichText), a card's description, a frame's
 * title. Null when nothing there matches (or it's locked).
 */
export function planReplace(editor: Editor, el: BoardElement, find: string, replacement: string, opts: SearchOptions = {}): ElementReplacement | null {
  if (el.locked || !find) return null;
  const caseSensitive = !!opts.caseSensitive;
  const parts: TextPart[] = [];
  for (const p of editor.getTextParts(el.id)) {
    const r = replaceInRichText(p.html, find, replacement, { caseSensitive });
    if (r.count) parts.push({ part: p.part, html: r.html });
  }
  const patch: Record<string, unknown> = {};
  if (el.type === 'card' && el.description) {
    const r = replaceInRichText(el.description, find, replacement, { caseSensitive });
    if (r.count) patch.description = r.html;
  }
  if (el.type === 'frame') {
    const title = replacePlain(el.title, find, replacement, caseSensitive);
    if (title !== el.title) patch.title = title;
  }
  const hasPatch = Object.keys(patch).length > 0;
  return parts.length || hasPatch ? { id: el.id, parts, patch: hasPatch ? (patch as ElementPatch) : null } : null;
}

function applyReplacement(editor: Editor, r: ElementReplacement) {
  if (r.patch) editor.update(r.id, r.patch);
  if (r.parts.length) editor.setTextParts(r.id, r.parts);
}

const isMine = (editor: Editor, s: Source) => s.kind === 'comment' && s.authorId === editor.user.id;

export interface ReplaceResult {
  /** Items and comments changed. */
  changed: number;
  /** Matching comments written by someone else: never rewritten (only authors edit comments). */
  othersComments: number;
}

/**
 * Replaces in `matches`: items as ONE undo step, your own comments through the comments feature
 * (comments are social data: not undoable, and only their author edits them).
 */
export function replaceMatches(editor: Editor, matches: Match[], find: string, replacement: string, opts: SearchOptions = {}): ReplaceResult {
  const plans: ElementReplacement[] = [];
  const mine: Array<{ threadId: string; messageId: string }> = [];
  let othersComments = 0;
  for (const m of matches) {
    const s = m.source;
    if (s.kind === 'comment') {
      if (!isMine(editor, s)) othersComments++;
      else if (replacePlain(s.text, find, replacement, !!opts.caseSensitive).trim()) mine.push({ threadId: s.threadId, messageId: s.messageId });
      continue;
    }
    const el = editor.getElement(s.id);
    const plan = el && planReplace(editor, el, find, replacement, opts);
    if (plan) plans.push(plan);
  }
  if (plans.length && editor.can('editor')) {
    editor.beginGesture();
    try {
      editor.transact(() => plans.forEach((p) => applyReplacement(editor, p)));
    } finally {
      editor.endGesture();
    }
  } else plans.length = 0;
  if (mine.length) editor.runCommand('comments.replaceText', { find, replacement, caseSensitive: !!opts.caseSensitive, only: mine });
  return { changed: plans.length + mine.length, othersComments };
}

/** Brings a match into view: an item fitted (never zoomed in past 100% or out of the current view's zoom needlessly), a comment's thread opened. */
export function revealMatch(editor: Editor, m: Match) {
  if (m.source.kind === 'element') {
    editor.zoomToFit([m.source.id], { maxZoom: Math.max(1, editor.getCamera().zoom), padding: 120 });
    return;
  }
  // The comments feature brings the pin into view and opens the thread.
  // Quietly: the find box keeps the focus, so Enter keeps stepping through the results.
  editor.runCommand('comments.openThread', { threadId: m.source.threadId, quiet: true });
}
