// The board side of CSV (KAI-136): which stickies and cards a CSV holds, and putting imported rows
// on the board through the shared structure layout, in ONE transaction (one undo step).
import { layoutStructure, richTextToPlain, type BoardElement, type CardElement, type ItemInput, type StickyElement, type Tag } from '@freero/shared';
import { nanoid } from 'nanoid';
import type { Editor, NewElement } from '@engine';
import type { ImportedRow, ItemRow } from './csv';

type Item = StickyElement | CardElement;
const isItem = (el: BoardElement | undefined): el is Item => el?.type === 'sticky' || el?.type === 'card';

/** The stickies and cards to export: the selection's (frames bring their contents), else the whole board; in reading order. */
export function itemsToExport(editor: Editor): Item[] {
  const sel = editor.getSelection();
  const all = editor.getElements();
  const picked = sel.length ? new Set(sel) : null;
  // A selected frame / kanban brings what is inside it (at any depth).
  for (let grew = !!picked; grew && picked; ) {
    grew = false;
    for (const el of all)
      if (!picked.has(el.id) && el.frameId && picked.has(el.frameId)) {
        picked.add(el.id);
        grew = true;
      }
  }
  return all
    .filter((el): el is Item => isItem(el) && (!picked || picked.has(el.id)))
    .sort((a, b) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x);
}

/** Rows for the CSV: tag and frame names, assignees by name (`names`: user id → name). */
export function toRows(editor: Editor, items: Item[], names: ReadonlyMap<string, string>): ItemRow[] {
  const tags = new Map(editor.collection<Tag>('tags').entries());
  const frameTitle = (id: string | null | undefined) => {
    const f = id ? editor.getElement(id) : undefined;
    if (!f) return '';
    if (f.type === 'frame') return f.title;
    if (f.type === 'kanban' || f.type === 'swimlane') return richTextToPlain(f.title);
    return '';
  };
  return items.map((el) => ({
    type: el.type,
    text: richTextToPlain(el.type === 'card' ? el.title : el.text),
    description: el.type === 'card' ? richTextToPlain(el.description) : '',
    color: el.color,
    tags: (el.tags ?? []).map((id) => tags.get(id)?.name).filter((n): n is string => !!n),
    status: el.type === 'card' ? (el.status ?? '') : '',
    assignee: el.type === 'card' && el.assigneeId ? (names.get(el.assigneeId) ?? '') : '',
    due: el.type === 'card' ? (el.dueDate ?? '') : '',
    frame: frameTitle(el.frameId),
  }));
}

/**
 * Lays the rows out (a grid, or a kanban by status) on a free spot of the board and creates them,
 * tags included, as one undo step. Returns the ids of what was created.
 */
export function placeRows(editor: Editor, rows: ImportedRow[], layout: 'grid' | 'kanban', title: string): string[] {
  const items: ItemInput[] = rows.map((r) => r.item);
  const laid = layoutStructure({ kind: 'items', items, layout, title }, { newId: () => nanoid(10) });
  const spot = editor.findFreeSpot(laid.size);
  // Items come after the kanban (when there is one), in row order.
  const created = laid.elements.map((d) => ({ ...d, x: d.x + spot.x, y: d.y + spot.y }) as unknown as NewElement);
  const offset = layout === 'kanban' ? 1 : 0;
  let ids: string[] = [];
  editor.transact(() => {
    ids = editor.createMany(created);
    const tagged = rows.flatMap((r, i) => (r.tagNames.length ? [{ id: ids[i + offset], names: r.tagNames }] : []));
    if (tagged.length) editor.runCommand('tags.applyNames', { items: tagged });
  });
  return ids;
}
