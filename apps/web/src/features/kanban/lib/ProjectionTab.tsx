// A tab other than the board, on the canvas (steps 3a, 3b): the kanban's cards drawn the tab's way
// inside the kanban's own box, which keeps the board's size (the tab is mine; the box is
// everyone's). The real cards keep their places on the board, folded away for me while I look at
// the tab, so switching back is instant. Each layout scrolls and takes keys while the kanban is
// selected (like a live embed) and draws only what is in view.
import { useMemo } from 'react';
import { calendarDateField, collectionSchema, tableRows, timelineFields, type KanbanElement, type ViewTab } from '@freero/shared';
import { useCanEdit, useWorldViewport, type Editor } from '@engine';
import { CalendarBody } from './CalendarView';
import { useKanbanCards, useMine } from './hooks';
import { GAP, HEADER_H } from './layout';
import { ListTab } from './ListView';
import { TableTab } from './TableTab';
import { myView } from './tabs';
import { TimelineBody } from './TimelineView';

export function ProjectionTab({ editor, k, tab, selected }: { editor: Editor; k: KanbanElement; tab: ViewTab; selected: boolean }) {
  if (tab.layout === 'table') return <TableTab editor={editor} k={k} tabId={tab.id} selected={selected} name={tab.name} />;
  if (tab.layout === 'list') return <ListTab editor={editor} k={k} tabId={tab.id} selected={selected} name={tab.name} />;
  return <DatesTab editor={editor} k={k} tab={tab} selected={selected} />;
}

/** A calendar or timeline tab: the cards its filter keeps, in its order, placed by their dates. */
function DatesTab({ editor, k, tab, selected }: { editor: Editor; k: KanbanElement; tab: ViewTab; selected: boolean }) {
  const { cards } = useKanbanCards(editor, k.id);
  const mine = useMine(editor, k.id, tab.id);
  const canEdit = useCanEdit();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => myView(editor, k, tab.id), [editor, k, tab.id, mine]);
  const schema = useMemo(() => collectionSchema(k), [k]);
  const rows = useMemo(() => (view ? tableRows(k, cards, view, { me: editor.user.id }) : []), [k, cards, view, editor]);
  const vp = useWorldViewport();
  const top = HEADER_H;
  const height = Math.max(0, k.h - HEADER_H - GAP / 2);
  if (!view) return null;
  const box = { top, height, left: GAP / 2, right: GAP / 2 };
  const editable = canEdit && !k.locked;
  if (view.layout === 'calendar')
    return (
      <div className="fr-kanban__table fr-kanban__proj" style={box}>
        <CalendarBody editor={editor} k={k} rows={rows} dateRef={calendarDateField(view, schema)} canEdit={editable} interactive={selected} label={`${tab.name}: cards of this kanban by date`} height={height} />
      </div>
    );
  if (view.layout !== 'timeline') return null;
  const t = timelineFields(view, schema);
  const clip = { top: vp.y - (k.y + top), bottom: vp.y + vp.h - (k.y + top) };
  return (
    <div className="fr-kanban__table fr-kanban__proj" style={box}>
      <TimelineBody
        editor={editor}
        k={k}
        rows={rows}
        sorted={!!view.sort?.length}
        startRef={t.start}
        endRef={t.end}
        scale={t.scale}
        lanes={t.lanes}
        canEdit={editable}
        interactive={selected}
        label={`${tab.name}: cards of this kanban on a timeline`}
        clip={clip}
        height={height}
      />
    </div>
  );
}
