// Rows of work items (a CSV import, KAI-136) → stickies or task cards, in a grid or on a kanban
// whose columns are the cards' statuses. Fully specified drafts, like the rest of the kit; a
// kanban's own arrange pass settles its items on insert, and cards measure their height on create.
import type { CardStatus, StickyColor } from '../elements';
import { STICKY_COLORS } from '../elements';
import { plainToRichText } from '../text';
import { STICKY_GAP, STICKY_SIZE } from './kit';
import { measureText } from './measure';
import { LAYOUT_LIMITS, LayoutError, type ElementDraft, type ItemInput, type LaidOut, type LayoutContext } from './types';

export const ITEM_CARD_W = 300;
const CARD_ACCENT = '#5B3FF0';
const KANBAN = { header: 52, colHead: 44, gap: 12, pad: 10, itemGap: 10, minBody: 180, colW: 320 };
const STATUS_COLUMNS: Array<{ status: CardStatus | null; title: string; color: string }> = [
  { status: 'todo', title: 'To do', color: '#8A89A3' },
  { status: 'doing', title: 'Doing', color: '#2E9BF0' },
  { status: 'done', title: 'Done', color: '#1FA463' },
];
const HEX_RE = /^#[0-9a-f]{6}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isStickyColor = (c: unknown): c is StickyColor => typeof c === 'string' && c in STICKY_COLORS;
const clip = (s: string) => s.slice(0, LAYOUT_LIMITS.text);

/** A card's height for its title and description at width `w` (the card feature measures it exactly on insert). */
export function cardHeight(w: number, title: string, desc: string): number {
  const inner = Math.max(40, w - 36);
  const t = measureText(title || ' ', { fontSize: 15, maxWidth: inner, bold: true, lineHeight: 20 / 15 });
  const d = desc ? Math.min(3, Math.max(1, Math.round(measureText(desc, { fontSize: 13, maxWidth: inner, lineHeight: 18 / 13 }).h / 18))) : 0;
  return Math.round(13 + Math.max(20, t.h) + (d ? 4 + d * 18 : 0) + 10 + 24 + 12);
}

function draft(it: ItemInput, id: string, x: number, y: number, w: number, frameId: string | null): ElementDraft {
  const tags = (it.tags ?? []).filter((t) => typeof t === 'string' && t);
  if (it.type === 'sticky') {
    return {
      id,
      x: Math.round(x),
      y: Math.round(y),
      w,
      h: w,
      rotation: 0,
      ...(frameId ? { frameId } : {}),
      type: 'sticky',
      color: isStickyColor(it.color) ? it.color : 'yellow',
      text: plainToRichText(clip(it.text)),
      fontFamily: 'sans',
      fontSize: 'auto',
      textColor: '#17162B',
      align: 'center',
      vAlign: 'middle',
      ...(tags.length ? { tags } : {}),
    };
  }
  const desc = clip(it.description ?? '');
  return {
    id,
    x: Math.round(x),
    y: Math.round(y),
    w,
    h: cardHeight(w, it.text, desc),
    rotation: 0,
    ...(frameId ? { frameId } : {}),
    type: 'card',
    title: plainToRichText(clip(it.text)),
    description: desc ? plainToRichText(desc) : '',
    color: typeof it.color === 'string' && HEX_RE.test(it.color) ? it.color : CARD_ACCENT,
    status: it.status ?? null,
    assigneeId: it.assigneeId ?? null,
    dueDate: it.dueDate && DATE_RE.test(it.dueDate) ? it.dueDate : null,
    tags,
  };
}

const itemW = (it: ItemInput) => (it.type === 'sticky' ? STICKY_SIZE : ITEM_CARD_W);
const itemH = (it: ItemInput, w: number) => (it.type === 'sticky' ? w : cardHeight(w, it.text, it.description ?? ''));

/** Items in rows (reading order), each row as tall as its tallest item. */
function grid(items: ItemInput[], ctx: LayoutContext): LaidOut {
  const cols = Math.max(1, Math.min(10, Math.ceil(Math.sqrt(items.length * 1.6))));
  const cellW = Math.max(...items.map(itemW));
  const elements: ElementDraft[] = [];
  let y = 0;
  for (let row = 0; row * cols < items.length; row++) {
    const slice = items.slice(row * cols, row * cols + cols);
    const h = Math.max(...slice.map((it) => itemH(it, itemW(it))));
    slice.forEach((it, i) => elements.push(draft(it, ctx.newId(), i * (cellW + STICKY_GAP), y, itemW(it), null)));
    y += h + STICKY_GAP;
  }
  return { elements, content: {}, moves: [], size: { w: Math.min(items.length, cols) * (cellW + STICKY_GAP) - STICKY_GAP, h: y - STICKY_GAP } };
}

/** A kanban with a column per status (items without one in the first), its items stacked in their column. */
function kanban(items: ItemInput[], title: string | undefined, ctx: LayoutContext): LaidOut {
  const K = KANBAN;
  const inner = K.colW - 2 * K.pad;
  const column = (it: ItemInput) => Math.max(0, STATUS_COLUMNS.findIndex((c) => c.status === (it.status ?? 'todo')));
  const id = ctx.newId();
  const heights = STATUS_COLUMNS.map(() => 0);
  const members: ElementDraft[] = [];
  for (const it of items) {
    const ci = column(it);
    const w = it.type === 'sticky' ? Math.min(STICKY_SIZE, inner) : inner;
    const x = K.gap + ci * (K.colW + K.gap) + K.pad + (inner - w) / 2;
    const y = K.header + K.colHead + K.pad + heights[ci];
    // A card in a column takes the column's status (as dropping it there would).
    const placed = it.type === 'card' ? { ...it, status: STATUS_COLUMNS[ci].status } : it;
    members.push(draft(placed, ctx.newId(), x, y, w, id));
    heights[ci] += itemH(it, w) + K.itemGap;
  }
  const w = K.gap + STATUS_COLUMNS.length * (K.colW + K.gap);
  const h = K.header + K.colHead + Math.max(K.minBody, Math.max(...heights) + 2 * K.pad) + K.gap;
  const board: ElementDraft = {
    id,
    x: 0,
    y: 0,
    w,
    h,
    rotation: 0,
    type: 'kanban',
    title: plainToRichText(clip(title?.trim() || 'Imported')),
    colW: K.colW,
    columns: STATUS_COLUMNS.map((c) => ({ id: ctx.newId(), title: plainToRichText(c.title), status: c.status, color: c.color })),
  };
  return { elements: [board, ...members], content: {}, moves: [], size: { w, h } };
}

export function layoutItems(items: ItemInput[], layout: 'grid' | 'kanban', title: string | undefined, ctx: LayoutContext): LaidOut {
  if (!items.length) throw new LayoutError('Nothing to lay out');
  if (items.length + 1 > LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements - 1} items at once`);
  for (const it of items)
    if (!it || (it.type !== 'sticky' && it.type !== 'card') || typeof it.text !== 'string') throw new LayoutError('Each item is a sticky or a card with text');
  return layout === 'kanban' ? kanban(items, title, ctx) : grid(items, ctx);
}
