// The data grid of the selected chart (#137), beside the board: labels down the left, one column
// per series. Every cell is its own record (lib/data.ts), so two people typing in different cells
// both keep what they typed. Pasting rows from a spreadsheet or a CSV replaces the data in one undo
// step; a paste that can't be a chart (a word where a number goes, too many series) changes nothing
// and says why.
import { useEffect, useMemo, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { CHART_HEAD, CHART_LABEL, chartColor, type ChartElement } from '@freero/shared';
import { DockHeader, definePanel, useCanEdit, useCollection, useSelectedElements, type Editor } from '@engine';
import { Button, Input } from '@ui';
import { addRow, addSeries, CELLS, cellOf, isValue, pasteRows, removeRow, removeSeries, setCell } from './lib/data';
import { DATA_PANEL } from './lib/constants';

function Cell({
  editor,
  chart,
  rowId,
  colId,
  value,
  numeric,
  disabled,
  placeholder,
  label,
}: {
  editor: Editor;
  chart: ChartElement;
  rowId: string;
  colId: string;
  value: string;
  numeric: boolean;
  disabled: boolean;
  placeholder?: string;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const bad = numeric && !isValue(shown);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft.trim() === value) return;
    if (numeric && !isValue(draft)) {
      editor.host.notify(`“${draft.trim().slice(0, 40)}” isn’t a number: the value stays ${value || 'empty'}.`, 'error');
      return;
    }
    editor.beginGesture();
    setCell(editor, chart.id, rowId, colId, draft);
    editor.endGesture();
  };
  return (
    <input
      className={`fr-chart-grid__cell${numeric ? ' is-number' : ''}${bad ? ' is-bad' : ''}`}
      value={shown}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={bad || undefined}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
      onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
        const text = e.clipboardData.getData('text/plain');
        if (pasteRows(editor, chart, text)) {
          e.preventDefault();
          setDraft(null);
        }
      }}
    />
  );
}

function ChartData({ editor, chart }: { editor: Editor; chart: ChartElement }) {
  const canEdit = useCanEdit();
  const entries = useCollection<string>(CELLS);
  const coll = useMemo(() => {
    const map = new Map(entries);
    return { get: (k: string) => map.get(k) };
  }, [entries]);
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => setTitle(null), [chart.id]);
  const cell = (rowId: string, colId: string, numeric: boolean, label: string, placeholder?: string) => (
    <Cell
      key={`${chart.id}:${rowId}:${colId}`}
      editor={editor}
      chart={chart}
      rowId={rowId}
      colId={colId}
      value={cellOf(coll, chart.id, rowId, colId)}
      numeric={numeric}
      disabled={!canEdit}
      label={label}
      placeholder={placeholder}
    />
  );
  return (
    <div className="fr-chart-data">
      <Input
        size="sm"
        aria-label="Chart title"
        placeholder="Title (optional)"
        disabled={!canEdit}
        value={title ?? chart.title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title !== null && title.trim() !== chart.title) editor.update<ChartElement>(chart.id, { title: title.trim().slice(0, 200) });
          setTitle(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <p className="fr-chart-data__hint">Type over the numbers, or paste rows from a spreadsheet or CSV: the first row names the series.</p>
      <div className="fr-chart-grid" role="table" aria-label="Chart data" data-fr-scrollable="">
        <div className="fr-chart-grid__row" role="row" style={{ gridTemplateColumns: `minmax(84px, 1.2fr) repeat(${chart.series.length}, minmax(72px, 1fr)) 24px` }}>
          <span className="fr-chart-grid__corner" role="columnheader">
            Label
          </span>
          {chart.series.map((s, i) => (
            <span key={s.id} className="fr-chart-grid__head" role="columnheader">
              <span className="fr-chart-grid__dot" style={{ background: chartColor(s, i) }} />
              {cell(CHART_HEAD, s.id, false, `Series ${i + 1} name`, `Series ${i + 1}`)}
              {canEdit && chart.series.length > 1 && (
                <button type="button" className="fr-chart-grid__x" aria-label={`Remove series ${i + 1}`} title="Remove this series" onClick={() => removeSeries(editor, chart, s.id)}>
                  <X size={12} aria-hidden />
                </button>
              )}
            </span>
          ))}
          <span />
        </div>
        {chart.rows.map((r, ri) => (
          <div key={r.id} className="fr-chart-grid__row" role="row" style={{ gridTemplateColumns: `minmax(84px, 1.2fr) repeat(${chart.series.length}, minmax(72px, 1fr)) 24px` }}>
            {cell(r.id, CHART_LABEL, false, `Row ${ri + 1} label`, `Row ${ri + 1}`)}
            {chart.series.map((s, i) => cell(r.id, s.id, true, `Row ${ri + 1}, series ${i + 1}`))}
            {canEdit && chart.rows.length > 1 ? (
              <button type="button" className="fr-chart-grid__x" aria-label={`Remove row ${ri + 1}`} title="Remove this row" onClick={() => removeRow(editor, chart, r.id)}>
                <X size={12} aria-hidden />
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="fr-chart-data__actions">
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => addRow(editor, chart)}>
            Row
          </Button>
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => addSeries(editor, chart)}>
            Series
          </Button>
        </div>
      )}
    </div>
  );
}

function ChartDataPanel({ editor }: { editor: Editor }) {
  const selected = useSelectedElements();
  const chart = selected.length === 1 && selected[0].type === 'chart' ? (selected[0] as ChartElement) : null;
  return (
    <div className="fr-chart-panel">
      <DockHeader className="fr-chart-panel__head">
        <h2 className="fr-chart-panel__title">Chart data</h2>
      </DockHeader>
      {chart ? <ChartData editor={editor} chart={chart} /> : <p className="fr-chart-data__hint">Select one chart to edit its data.</p>}
    </div>
  );
}

export default definePanel({
  id: DATA_PANEL,
  slot: 'dock-right',
  order: 50,
  Component: ChartDataPanel,
});
