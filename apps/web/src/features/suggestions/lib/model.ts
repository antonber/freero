// How suggestions read to a reviewer: grouped as proposed, each item named and previewed, and the
// accept / reject actions with their outcome said out loud (stale ones ask before overwriting).
import { suggestedElement, type BoardElement } from '@freero/shared';
import { describeElementType, richTextToPlain, type Editor, type Rect, type Suggestion } from '@engine';

export const PANEL_ID = 'suggestions.panel';

export interface SuggestionGroup {
  id: string;
  /** "Claude for Maria", or a person's name. */
  by: string;
  description: string;
  createdAt: number;
  items: Suggestion[];
  stale: number;
}

export const authorLabel = (s: Suggestion) => (s.author.kind === 'person' ? s.author.name : `${s.author.name} for ${s.author.userName}`);

/** Pending suggestions grouped as proposed, oldest group first. */
export function groupSuggestions(list: readonly Suggestion[]): SuggestionGroup[] {
  const out = new Map<string, SuggestionGroup>();
  for (const s of list) {
    let g = out.get(s.groupId);
    if (!g) out.set(s.groupId, (g = { id: s.groupId, by: authorLabel(s), description: s.description, createdAt: s.createdAt, items: [], stale: 0 }));
    g.items.push(s);
    if (s.state !== 'ready') g.stale++;
  }
  return [...out.values()];
}

/** The item a suggestion shows: as it would be once accepted (a deletion: the item it deletes). */
export const previewElement = (editor: Editor, s: Suggestion): BoardElement | null => suggestedElement(s, (id) => editor.getElement(id));

/** One line of an item's text. */
export function textOf(editor: Editor, el: BoardElement | null | undefined): string {
  if (!el) return '';
  let text = editor.getDefinition(el.type)?.toPlainText?.(el as never, editor) ?? '';
  const rec = el as unknown as Record<string, unknown>;
  if (!text && typeof rec.title === 'string') text = richTextToPlain(rec.title);
  if (!text && typeof rec.text === 'string') text = richTextToPlain(rec.text);
  return text.replace(/\s+/g, ' ').trim();
}

const FIELD_NAMES: Record<string, string> = {
  text: 'text',
  title: 'title',
  description: 'description',
  x: 'position',
  y: 'position',
  w: 'size',
  h: 'size',
  rotation: 'rotation',
  frameId: 'frame',
  color: 'color',
  fill: 'fill',
  stroke: 'line color',
  textColor: 'text color',
  status: 'status',
  dueDate: 'due date',
  assigneeId: 'assignee',
  locked: 'lock',
  hidden: 'visibility',
  link: 'link',
  label: 'label',
  start: 'line ends',
  end: 'line ends',
  waypoints: 'route',
};

/** What a suggestion does, in a few words: "Add sticky note", "Change text, color of card", "Delete shape". */
export function actionLabel(editor: Editor, s: Suggestion): string {
  const el = previewElement(editor, s);
  const type = el ? describeElementType(editor, el.type).one.toLowerCase() : 'item';
  if (s.op === 'create') return `Add ${type}`;
  if (s.op === 'delete') return `Delete ${type}`;
  const fields = [...new Set(Object.keys(s.patch ?? {}).map((k) => FIELD_NAMES[k] ?? k))];
  return `Change ${fields.slice(0, 3).join(', ')}${fields.length > 3 ? '…' : ''} of ${type}`;
}

export const staleLabel = (s: Suggestion) =>
  s.state === 'changed' ? 'Changed since it was suggested' : s.state === 'gone' ? (s.op === 'create' ? 'An item it connects to is gone' : 'The item is gone') : '';

/** Bounds of the item a suggestion shows (unrotated box; enough to place a badge or zoom to it). */
export function boundsOf(editor: Editor, s: Suggestion): Rect | null {
  const el = previewElement(editor, s);
  return el ? { x: el.x, y: el.y, w: el.w, h: el.h } : null;
}

export function unionOf(rects: Array<Rect | null>): Rect | null {
  let out: Rect | null = null;
  for (const r of rects) {
    if (!r) continue;
    if (!out) out = { ...r };
    else {
      const x = Math.min(out.x, r.x);
      const y = Math.min(out.y, r.y);
      out = { x, y, w: Math.max(out.x + out.w, r.x + r.w) - x, h: Math.max(out.y + out.h, r.y + r.h) - y };
    }
  }
  return out;
}

/**
 * Accepts suggestions and says what happened. Stale ones are never applied silently: the toast
 * names them and offers to apply them anyway.
 */
export function accept(editor: Editor, ids: string[]): void {
  const r = editor.acceptSuggestions(ids);
  if (r.stale.length) {
    const n = r.stale.length;
    editor.host.notify(
      n === 1 ? 'This suggestion is out of date: the item changed or is gone since.' : `${n} of these suggestions are out of date: their items changed or are gone since.`,
      'info',
      { action: { label: 'Apply anyway', run: () => editor.acceptSuggestions(ids, { force: true }) } },
    );
  }
}

export function reject(editor: Editor, ids: string[]): void {
  editor.rejectSuggestions(ids);
}

/** Zooms to what a suggestion (or group) shows. */
export function focus(editor: Editor, list: readonly Suggestion[]): void {
  const r = unionOf(list.map((s) => boundsOf(editor, s)));
  if (r) editor.zoomToRect({ x: r.x - 80, y: r.y - 80, w: r.w + 160, h: r.h + 160 });
}
