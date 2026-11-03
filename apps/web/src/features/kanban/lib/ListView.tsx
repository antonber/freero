// A list of the kanban's cards (step 3b): compact rows — the title and a few fields as chips —
// grouped by a field. The 3a grid in its lighter dress (`is-list`), so it keeps the grid's
// keyboard walk, cell editors, screen-reader labels and windowing; Alt+↑ / Alt+↓ moves a card to
// the previous / next group (one card.setValues; grouped by the board's column field, the real
// card moves to that column). A list tab draws it inside the kanban's box; focus mode draws it as
// its List layout.
import { useMemo, type MutableRefObject, type ReactNode } from 'react';
import { collectionSchema, listColumns, listGroupField, type FieldDef, type KanbanElement } from '@freero/shared';
import { useCanEdit, useWorldViewport, type Editor } from '@engine';
import { Grid, type GridApi, type GridEntry } from './Grid';
import { focusEntries } from './focusSettings';
import { useKanbanCards, useMine, useTags } from './hooks';
import { GAP, HEADER_H } from './layout';
import { useKanbanPeople } from './people';
import { moveToGroup } from './projection';
import { gridColumns, TITLE_WIDTH } from './table';
import { myView } from './tabs';

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

/** A list tab on the canvas: the list inside the kanban's box, drawn only where the window shows it. */
export function ListTab({ editor, k, tabId, selected, name }: { editor: Editor; k: KanbanElement; tabId: string; selected: boolean; name: string }) {
  const { cards } = useKanbanCards(editor, k.id);
  const mine = useMine(editor, k.id, tabId);
  const canEdit = useCanEdit();
  const people = useKanbanPeople(editor);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => myView(editor, k, tabId), [editor, k, tabId, mine]);
  const schema = useMemo(() => collectionSchema(k), [k]);
  const list = view?.layout === 'list' ? view : null;
  const { entries, group } = useMemo(() => {
    const names = new Map(people.map((x) => [x.id, x.name]));
    const groupBy = list ? (listGroupField(k, list, schema)?.id ?? null) : null;
    return focusEntries(k, cards, { groupBy, filter: list?.filter ?? null, sort: list?.sort ?? [] }, { me: editor.user.id, personName: (id) => names.get(id) });
  }, [k, cards, list, schema, people, editor]);
  const vp = useWorldViewport();
  const top = HEADER_H;
  const height = Math.max(0, k.h - HEADER_H - GAP / 2);
  if (!list) return null;
  const clip = { top: vp.y - (k.y + top), bottom: vp.y + vp.h - (k.y + top) };
  return (
    <div className="fr-kanban__table" style={{ top, height, left: GAP / 2, right: GAP / 2 }}>
      <ListBody
        editor={editor}
        k={k}
        entries={entries}
        group={group}
        columns={listColumns(k, list, schema)}
        canEdit={canEdit && !k.locked}
        rowH={LIST_ROW_H}
        label={`${name}: cards of this kanban as a list`}
        interactive={selected}
        clip={clip}
        height={height}
        empty={cards.length ? 'This tab’s filter leaves out every card.' : 'No cards yet. Cards on the Board tab show here as a list.'}
      />
    </div>
  );
}
