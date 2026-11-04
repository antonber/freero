// The timeline view of a table's rows (#51): a bar per row between its two date columns
// (TableElement.timeline), on a day axis around them (@freero/shared `timelineRange`, as a kanban's
// timeline tab). Dragging a bar moves it, its ends resize it (`editBar`): the row's date cells
// change, the same cells the grid shows. The header row names the columns; it has no bar.
import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { editBar, timelineLayout, type BarEdit, type DaySpan, type TableColumn, type TableElement } from '@freero/shared';
import type { Editor } from '@engine';
import { formatDate } from '@ui';
import { displayValue, optionOf, rowSpan, timelineDaysOf, typeOf, visibleRows, type PeopleLookup } from './columns';
import { setRowSpan, today } from './actions';
import { TIMELINE } from './model';
import { t } from '../messages';

/** Screen px of a bar's end that resizes it rather than moving it. */
const EDGE_PX = 6;
const BAR_FILL = '#D3C4FF';

/** Month spans of [start, end] (day numbers): where each month's label goes. */
function months(span: DaySpan): Array<{ from: number; to: number; label: string }> {
  const out: Array<{ from: number; to: number; label: string }> = [];
  let d = span.start;
  while (d <= span.end) {
    const [y, m] = timelineLayout.isoOf(d).split('-').map(Number);
    const next = timelineLayout.dayOf(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`);
    out.push({ from: d, to: Math.min(span.end + 1, next), label: formatDate(Date.UTC(y, m - 1, 1), { month: 'short', year: 'numeric', timeZone: 'UTC' }) });
    d = next;
  }
  return out;
}

export function TimelineView({
  editor,
  table,
  get,
  people,
  interactive,
  zoom,
}: {
  editor: Editor;
  table: TableElement;
  get: (rowId: string, colId: string) => string;
  people: PeopleLookup;
  interactive: boolean;
  zoom: number;
}) {
  const [drag, setDrag] = useState<{ rowId: string; span: DaySpan } | null>(null);
  const days = timelineDaysOf(table, get, today(editor));
  const dayW = Math.max(1, (table.w - TIMELINE.labelW) / (days.end - days.start + 1));
  const x = (day: number) => TIMELINE.labelW + (day - days.start) * dayW;
  const head = table.header ? table.rows[0] : null;
  const rows = visibleRows(table, get).filter((r) => r !== head);
  const datesOf = new Set([table.timeline?.start, table.timeline?.end]);
  const titleCol: TableColumn = table.cols.find((c) => typeOf(c) === 'text' && !datesOf.has(c.id)) ?? table.cols[0];
  const colorCol = table.cols.find((c) => typeOf(c) === 'select');
  const now = today(editor);

  const startDrag = (e: ReactPointerEvent, rowId: string, span: DaySpan) => {
    if (!interactive || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const z = editor.getCamera().zoom || zoom;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const edit: BarEdit = e.clientX - box.left <= EDGE_PX ? 'start' : box.right - e.clientX <= EDGE_PX ? 'end' : 'move';
    const from = e.clientX;
    let last = span;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      last = editBar(span, edit, Math.round((ev.clientX - from) / z / dayW));
      setDrag({ rowId, span: last });
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      setDrag(null);
      if (ev.type === 'pointerup' && (last.start !== span.start || last.end !== span.end)) setRowSpan(editor, table.id, rowId, last);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  };

  if (!table.timeline) return <div className="fr-table-board__empty">{t('addADateColumnTo')}</div>;
  return (
    <div className="fr-table-tl" style={{ ['--tl-label' as string]: `${TIMELINE.labelW}px` }}>
      <div className="fr-table-tl__head" style={{ height: TIMELINE.head }}>
        <div className="fr-table-tl__corner">{head ? displayValue(undefined, get(head.id, titleCol.id)) : ''}</div>
        {months(days).map((m) => (
          <div key={m.from} className="fr-table-tl__month" style={{ left: x(m.from), width: (m.to - m.from) * dayW }}>
            {(m.to - m.from) * dayW > 48 ? m.label : ''}
          </div>
        ))}
      </div>
      {now >= days.start && now <= days.end && <div className="fr-table-tl__today" style={{ left: x(now) + dayW / 2, top: TIMELINE.head }} aria-hidden />}
      {rows.map((r, i) => {
        const span = drag?.rowId === r.id ? drag.span : rowSpan(table, get, r.id);
        const top = TIMELINE.head + i * TIMELINE.rowH;
        const fill = (colorCol && optionOf(colorCol, get(r.id, colorCol.id))?.color) || BAR_FILL;
        const title = displayValue(titleCol, get(r.id, titleCol.id), people) || 'Untitled';
        return (
          <div key={r.id} className="fr-table-tl__row" style={{ top, height: TIMELINE.rowH }}>
            <div className="fr-table-tl__label" title={title}>
              {title}
            </div>
            {span ? (
              <div
                className={`fr-table-tl__bar${drag?.rowId === r.id ? ' is-dragging' : ''}`}
                style={{ left: x(span.start), width: Math.max(dayW, (span.end - span.start + 1) * dayW), background: fill }}
                title={`${timelineLayout.isoOf(span.start)} → ${timelineLayout.isoOf(span.end)}`}
                {...(interactive ? { 'data-fr-interactive': '' } : {})}
                onPointerDown={(e) => startDrag(e, r.id, span)}
              >
                {title}
              </div>
            ) : (
              <div className="fr-table-tl__nodate" style={{ left: TIMELINE.labelW + 8 }}>{t('noDates')}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
