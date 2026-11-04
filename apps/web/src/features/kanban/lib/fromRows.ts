// A new kanban made from rows (`kanban.createFromRows`, step 3e): another feature (the table's
// "Convert to kanban") hands over columns, fields and cards as words and values, and the kanban
// makes them, so a kanban and its cards are never written by a feature that doesn't own them.
// The rules (fields, options, values, geometry) are @freero/shared `layoutKanbanRows`.
import { nanoid } from 'nanoid';
import { LayoutError, layoutKanbanRows, type ElementDraft, type FrameElement, type KanbanRowsInput } from '@freero/shared';
import type { Editor, NewElement, Point } from '@engine';

import { t } from '../messages';
const isPoint = (p: unknown): p is Point => !!p && typeof p === 'object' && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y);

/**
 * Creates the kanban `rows` describe with its top-left at `at` (else on a free spot), inside frame
 * `frameId` when that is a frame, as kanban `id` when that id is free. One transaction (the
 * caller's, when it has one: one undo step with whatever it does around it). Returns the kanban's
 * id, or null (with a message) when the rows can't make a kanban.
 */
export function createFromRows(editor: Editor, args: { rows?: unknown; at?: unknown; id?: unknown; frameId?: unknown }): string | null {
  let laid;
  try {
    laid = layoutKanbanRows(args.rows as KanbanRowsInput, { newId: () => nanoid(10) });
  } catch (e) {
    if (!(e instanceof LayoutError)) throw e;
    editor.host.notify(t('couldnTMakeTheKanban', { message: e.message }), 'error');
    return null;
  }
  const [board, ...cards] = laid.elements;
  const id = typeof args.id === 'string' && /^[\w-]{1,64}$/.test(args.id) && !editor.getElement(args.id) ? args.id : board.id;
  const frame = typeof args.frameId === 'string' ? editor.getElement<FrameElement>(args.frameId) : undefined;
  const at = isPoint(args.at) ? args.at : editor.findFreeSpot(laid.size);
  const place = (d: ElementDraft) => ({ ...d, x: d.x + at.x, y: d.y + at.y });
  editor.transact(() => {
    editor.createMany([
      { ...place(board), id, ...(frame?.type === 'frame' ? { frameId: frame.id } : {}) } as unknown as NewElement,
      ...cards.map((c) => ({ ...place(c), frameId: id }) as unknown as NewElement),
    ]);
  });
  return editor.getElement(id) ? id : null;
}
