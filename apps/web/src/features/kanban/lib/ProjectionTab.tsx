// A collection's cards drawn a projection's way (steps 3a, 3b, 3c) inside a box on the canvas: a
// kanban's own tab other than the board (the box is the kanban's, which keeps the board's size:
// the tab is mine, the box everyone's), or a linked view elsewhere on the board (lib/LinkedView.tsx,
// its own box). Both hand `ProjectionBody` the collection, the view as this person sees it and
// what they may do; the body draws the table, list, calendar or timeline from the live cards and
// never moves one (its edits go through card.setValues). Each layout scrolls and takes keys while
// its host is selected (like a live embed) and draws only what is in view.
import { useMemo } from 'react';
import { calendarDateField, collectionSchema, listColumns, listGroupField, tableColumns, tableRows, timelineFields, type KanbanElement, type ProjectionView, type ViewTab } from '@freero/shared';
import { useCanEdit, useWorldViewport, type Editor, type Rect } from '@engine';
import { CalendarBody } from './CalendarView';
import { focusEntries } from './focusSettings';
import { Grid, type GridEntry } from './Grid';
import { useKanbanCards, useMine, useTags } from './hooks';
import { GAP, HEADER_H } from './layout';
import { LIST_ROW_H, ListBody } from './ListView';
import { useKanbanPeople } from './people';
import { gridColumns } from './table';
import { myView } from './tabs';
import { TimelineBody } from './TimelineView';

import { t as tr } from '../messages';
/** A canvas table's row height. */
export const CANVAS_ROW_H = 40;

export interface ProjectionBodyProps {
  editor: Editor;
  /** The collection whose cards it draws. */
  k: KanbanElement;
  /** The view as this person sees it (their own changes on top of the saved one). */
  view: ProjectionView;
  /** Its name, for labels ("Hot list"). */
  name: string;
  /** What the labels call the collection: "this kanban", or "Sprint" for a linked view. */
  of: string;
  /** "tab" (a kanban's own) or "view" (a linked view), for what its empty states say. */
  noun: 'tab' | 'view';
  /** Cells, days and bars can be changed (the role, the kanban's and the host's locks). */
  canEdit: boolean;
  /** Takes pointer, wheel and keys (its host is selected). */
  interactive: boolean;
  /** The box it fills, element-local (world units). */
  box: { top: number; left: number; right: number; height: number };
  /** The part of the box in the window, px from the box's top; null: all of it. */
  clip: { top: number; bottom: number } | null;
}

/** The part of a box (its top at world `y`) the window `vp` shows, in the box's own coordinates. */
export const clipOf = (vp: Rect, y: number) => ({ top: vp.y - y, bottom: vp.y + vp.h - y });

export function ProjectionBody(p: ProjectionBodyProps) {
  const { view } = p;
  if (view.layout === 'table') return <TableProjection {...p} view={view} />;
  if (view.layout === 'list') return <ListProjection {...p} view={view} />;
  return <DatesProjection {...p} />;
}

/** A kanban's own tab other than the board, inside the kanban's box. */
export function ProjectionTab({ editor, k, tab, selected }: { editor: Editor; k: KanbanElement; tab: ViewTab; selected: boolean }) {
  const mine = useMine(editor, k.id, tab.id);
  const canEdit = useCanEdit();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => myView(editor, k, tab.id), [editor, k, tab.id, mine]);
  const vp = useWorldViewport();
  if (!view) return null;
  const top = HEADER_H;
  return (
    <ProjectionBody
      editor={editor}
      k={k}
      view={view}
      name={tab.name}
      of={tr('thisKanban')}
      noun="tab"
      canEdit={canEdit && !k.locked}
      interactive={selected}
      box={{ top, left: GAP / 2, right: GAP / 2, height: Math.max(0, k.h - HEADER_H - GAP / 2) }}
      clip={clipOf(vp, k.y + top)}
    />
  );
}

const boxStyle = (b: ProjectionBodyProps['box']) => ({ top: b.top, left: b.left, right: b.right, height: b.height });

/** A table: the cards its filter keeps as rows, in its order, a typed column per field. */
function TableProjection(p: ProjectionBodyProps & { view: Extract<ProjectionView, { layout: 'table' }> }) {
  const { editor, k, view } = p;
  const { cards } = useKanbanCards(editor, k.id);
  const tags = useTags(editor);
  const schema = useMemo(() => collectionSchema(k), [k]);
  const columns = useMemo(() => gridColumns(tableColumns(view, schema), schema, tags), [view, schema, tags]);
  const rows = useMemo(() => tableRows(k, cards, view, { me: editor.user.id }), [k, cards, view, editor]);
  const entries = useMemo<GridEntry[]>(() => rows.map((card) => ({ kind: 'card', card })), [rows]);
  const hidden = cards.length - rows.length;
  return (
    <div className="fr-kanban__table" style={boxStyle(p.box)}>
      <Grid
        editor={editor}
        k={k}
        schema={schema}
        entries={entries}
        columns={columns}
        canEdit={p.canEdit}
        rowH={CANVAS_ROW_H}
        label={tr('nameCardsOfOf', { name: p.name, of: p.of })}
        interactive={p.interactive}
        clip={p.clip}
        height={p.box.height}
        empty={hidden ? tr('thisNounSFilterLeaves', { noun: p.noun, hidden }) : tr('noCardsYetCardsOn', { value: p.noun === 'tab' ? tr('theBoardTab') : tr('ofSBoard', { of: p.of }) })}
      />
      {hidden > 0 && rows.length > 0 && <span className="fr-kanban__table-note">{tr('hiddenLeftOutByThis', { hidden, noun: p.noun })}</span>}
    </div>
  );
}

/** A list: compact rows grouped by a field. */
function ListProjection(p: ProjectionBodyProps & { view: Extract<ProjectionView, { layout: 'list' }> }) {
  const { editor, k, view } = p;
  const { cards } = useKanbanCards(editor, k.id);
  const people = useKanbanPeople(editor);
  const schema = useMemo(() => collectionSchema(k), [k]);
  const { entries, group } = useMemo(() => {
    const names = new Map(people.map((x) => [x.id, x.name]));
    const groupBy = listGroupField(k, view, schema)?.id ?? null;
    return focusEntries(k, cards, { groupBy, filter: view.filter ?? null, sort: view.sort ?? [] }, { me: editor.user.id, personName: (id) => names.get(id) });
  }, [k, cards, view, schema, people, editor]);
  return (
    <div className="fr-kanban__table" style={boxStyle(p.box)}>
      <ListBody
        editor={editor}
        k={k}
        entries={entries}
        group={group}
        columns={listColumns(k, view, schema)}
        canEdit={p.canEdit}
        rowH={LIST_ROW_H}
        label={tr('nameCardsOfOfAs', { name: p.name, of: p.of })}
        interactive={p.interactive}
        clip={p.clip}
        height={p.box.height}
        empty={cards.length ? tr('thisNounSFilterLeaves2', { noun: p.noun }) : tr('noCardsYetCardsOn2', { value: p.noun === 'tab' ? tr('theBoardTab') : tr('ofSBoard', { of: p.of }) })}
      />
    </div>
  );
}

/** A calendar or a timeline: the cards its filter keeps, in its order, placed by their dates. */
function DatesProjection(p: ProjectionBodyProps) {
  const { editor, k, view } = p;
  const { cards } = useKanbanCards(editor, k.id);
  const schema = useMemo(() => collectionSchema(k), [k]);
  const rows = useMemo(() => tableRows(k, cards, view, { me: editor.user.id }), [k, cards, view, editor]);
  if (view.layout === 'calendar')
    return (
      <div className="fr-kanban__table fr-kanban__proj" style={boxStyle(p.box)}>
        <CalendarBody editor={editor} k={k} rows={rows} dateRef={calendarDateField(view, schema)} canEdit={p.canEdit} interactive={p.interactive} label={tr('nameCardsOfOfBy', { name: p.name, of: p.of })} height={p.box.height} />
      </div>
    );
  if (view.layout !== 'timeline') return null;
  const t = timelineFields(view, schema);
  return (
    <div className="fr-kanban__table fr-kanban__proj" style={boxStyle(p.box)}>
      <TimelineBody
        editor={editor}
        k={k}
        rows={rows}
        sorted={!!view.sort?.length}
        startRef={t.start}
        endRef={t.end}
        scale={t.scale}
        lanes={t.lanes}
        canEdit={p.canEdit}
        interactive={p.interactive}
        label={tr('nameCardsOfOfOn', { name: p.name, of: p.of })}
        clip={p.clip}
        height={p.box.height}
      />
    </div>
  );
}
