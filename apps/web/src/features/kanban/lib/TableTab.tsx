// A table tab on the canvas (step 3a): the kanban's cards as rows inside the kanban's own box,
// which keeps the board's size (the tab is mine; the box is everyone's). It draws the cards
// itself, from the live elements, and never moves them: the real cards keep their places on the
// board, folded away for me while I look at the table, so switching back is instant. Scrolls and
// takes keys while the kanban is selected (like a live embed); draws only the rows in view: the
// part of the box the window shows (useWorldViewport) and of its own scroll.
import { useMemo } from 'react';
import { collectionSchema, tableColumns, tableRows, type KanbanElement } from '@freero/shared';
import { useCanEdit, useWorldViewport, type Editor } from '@engine';
import { Grid, type GridEntry } from './Grid';
import { useKanbanCards, useMine, useTags } from './hooks';
import { HEADER_H, GAP } from './layout';
import { gridColumns } from './table';
import { myTableView } from './tabs';

export const CANVAS_ROW_H = 40;

export function TableTab({ editor, k, tabId, selected, name }: { editor: Editor; k: KanbanElement; tabId: string; selected: boolean; name: string }) {
  const { cards } = useKanbanCards(editor, k.id);
  const mine = useMine(editor, k.id, tabId);
  const canEdit = useCanEdit();
  const tags = useTags(editor);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => myTableView(editor, k, tabId), [editor, k, tabId, mine]);
  const schema = useMemo(() => collectionSchema(k), [k]);
  const columns = useMemo(() => (view ? gridColumns(tableColumns(view, schema), schema, tags) : []), [view, schema, tags]);
  const rows = useMemo(() => (view ? tableRows(k, cards, view, { me: editor.user.id }) : []), [k, cards, view, editor]);
  const entries = useMemo<GridEntry[]>(() => rows.map((card) => ({ kind: 'card', card })), [rows]);
  const vp = useWorldViewport();
  const top = HEADER_H;
  const height = Math.max(0, k.h - HEADER_H - GAP / 2);
  // The part of the box in the window, in the box's own coordinates.
  const clip = { top: vp.y - (k.y + top), bottom: vp.y + vp.h - (k.y + top) };
  if (!view) return null;
  const hidden = cards.length - rows.length;
  return (
    <div className="fr-kanban__table" style={{ top, height, left: GAP / 2, right: GAP / 2 }}>
      <Grid
        editor={editor}
        k={k}
        schema={schema}
        entries={entries}
        columns={columns}
        canEdit={canEdit && !k.locked}
        rowH={CANVAS_ROW_H}
        label={`${name}: cards of this kanban`}
        interactive={selected}
        clip={clip}
        height={height}
        empty={hidden ? `This tab’s filter leaves out all ${hidden} cards.` : 'No cards yet. Cards on the Board tab show here as rows.'}
      />
      {hidden > 0 && rows.length > 0 && <span className="fr-kanban__table-note">{hidden} left out by this tab’s filter</span>}
    </div>
  );
}
