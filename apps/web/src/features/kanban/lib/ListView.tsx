// A list of the kanban's cards (step 3b): compact rows — the title and a few fields as chips —
// grouped by a field. The 3a grid in its lighter dress (`is-list`), so it keeps the grid's
// keyboard walk, cell editors, screen-reader labels and windowing; Alt+↑ / Alt+↓ moves a card to
// the previous / next group (one card.setValues; grouped by the board's column field, the real
// card moves to that column). A list tab or a linked view draws it in its box (ProjectionTab.tsx);
// focus mode draws it as its List layout.
import { useMemo, type MutableRefObject, type ReactNode } from 'react';
import { collectionSchema, type FieldDef, type KanbanElement } from '@freero/shared';
import type { Editor } from '@engine';
import { Grid, type GridApi, type GridEntry } from './Grid';
import { useTags } from './hooks';
import { moveToGroup } from './projection';
import { gridColumns, TITLE_WIDTH } from './table';

export interface ListBodyProps {
  editor: Editor;
  k: KanbanElement;
  /** The rows (focusEntries) and the field they are grouped by (null: none). */
  entries: readonly GridEntry[];
  group: FieldDef | null;
  /** The fields shown after the title. */
  columns: readonly string[];
  canEdit: boolean;
  rowH: number;
  label: string;
  interactive: boolean;
  clip?: { top: number; bottom: number } | null;
  height?: number;
  descriptions?: boolean;
  api?: MutableRefObject<GridApi | null>;
  empty?: ReactNode;
  /** The title column's width (phones: what the screen has). */
  titleWidth?: number;
}

/** Wider title, narrower chips: a list reads as a line per card. */
const LIST_TITLE_W = TITLE_WIDTH + 80;
const LIST_FIELD_W = 168;

export function ListBody(p: ListBodyProps) {
  const { editor, k, entries, group } = p;
  const schema = useMemo(() => collectionSchema(k), [k]);
  const tags = useTags(editor);
  const columns = useMemo(
    () => gridColumns(p.columns, schema, tags).map((c, i) => ({ ...c, width: i === 0 ? (p.titleWidth ?? LIST_TITLE_W) : Math.min(c.width, LIST_FIELD_W) })),
    [p.columns.join('\n'), schema, tags, p.titleWidth], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const present = useMemo(() => entries.flatMap((e) => (e.kind === 'group' ? [e.key] : [])), [entries]);
  return (
    <Grid
      editor={editor}
      k={k}
      schema={schema}
      entries={entries}
      columns={columns}
      canEdit={p.canEdit}
      rowH={p.rowH}
      descriptions={p.descriptions}
      label={p.label}
      interactive={p.interactive}
      clip={p.clip}
      height={p.height}
      api={p.api}
      className="is-list"
      empty={p.empty}
      onMoveGroup={group ? (card, dir) => void moveToGroup(editor, k, card, group, dir, present) : undefined}
    />
  );
}

export const LIST_ROW_H = 40;
