// Importing a CSV / TSV as stickies or task cards (KAI-136): pick a file (or paste), check the
// columns, then the rows land in a grid or on a kanban by status — one undo step.
import { useEffect, useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { LAYOUT_LIMITS } from '@freero/shared';
import { definePanel, type PanelProps } from '@engine';
import { Button, Modal, SegmentedControl, Select, TextArea, Toggle } from '@ui';
import { CSV_IMPORT_DIALOG } from './lib/actions';
import { placeRows } from './lib/board';
import { FIELDS, guessMapping, parseDelimited, rowsToItems, sniffDelimiter, type Field, type Mapping } from './lib/csv';
import './csv.css';

const MAX_ROWS = LAYOUT_LIMITS.elements - 1;
const NONE = -1;

function ImportDialog({ editor }: PanelProps) {
  const close = () => editor.closePanel(CSV_IMPORT_DIALOG);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [as, setAs] = useState<'sticky' | 'card'>('card');
  const [layout, setLayout] = useState<'grid' | 'kanban'>('grid');
  const [mapping, setMapping] = useState<Mapping>({});
  const [people, setPeople] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => (text.trim() ? parseDelimited(text, sniffDelimiter(text)) : []), [text]);
  const header = hasHeader ? (rows[0] ?? []) : (rows[0] ?? []).map((_, i) => `Column ${i + 1}`);
  const body = hasHeader ? rows.slice(1) : rows;
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));

  // A new file (or the header switch) re-guesses which column is which.
  useEffect(() => setMapping(guessMapping(header)), [text, hasHeader]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    editor.host.listMembers().then(
      (ms) => setPeople(new Map(ms.map((m) => [m.name.trim().toLowerCase(), m.id]))),
      () => undefined,
    );
  }, [editor]);

  const items = useMemo(() => rowsToItems(body.slice(0, MAX_ROWS), { as, mapping, people }), [body, as, mapping, people]);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError('That file is over 5 MB');
    setError(null);
    setFileName(file.name);
    setText(await file.text());
  };

  const run = () => {
    if (!items.length) return setError('No rows with text to import');
    try {
      const ids = placeRows(editor, items, layout, fileName?.replace(/\.[^.]+$/, '') ?? 'Imported');
      editor.select(ids);
      editor.zoomToFit(ids);
      editor.host.notify(`Imported ${items.length} ${as === 'card' ? 'cards' : 'stickies'}${body.length > MAX_ROWS ? ` (first ${MAX_ROWS} rows)` : ''}`, 'success');
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import that file');
    }
  };

  const columnOptions = [{ value: NONE, label: '—' }, ...header.slice(0, width).map((h, i) => ({ value: i, label: h || `Column ${i + 1}` }))];
  const fields = FIELDS.filter((f) => as === 'card' || ['text', 'tags', 'color', 'type', 'status'].includes(f.field));
  return (
    <Modal
      open
      onClose={close}
      title="Import from CSV"
      description="Each row becomes a sticky or a task card. Tags, status, assignee and due date come from their columns."
      width={620}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!items.length} onClick={run}>
            {items.length ? `Import ${items.length}` : 'Import'}
          </Button>
        </>
      }
    >
      <div className="fr-csv">
        <div className="fr-csv__source">
          <label className="fr-csv__file">
            <Upload size={16} aria-hidden />
            <span>{fileName ?? 'Choose a .csv or .tsv file'}</span>
            <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" onChange={(e) => void readFile(e.target.files?.[0])} />
          </label>
          <span className="fr-csv__or">or paste</span>
        </div>
        <TextArea
          aria-label="CSV text"
          rows={4}
          placeholder={'Title,Status,Assignee,Due date,Tags\nWrite the brief,doing,Ann,2026-11-04,marketing'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileName(null);
          }}
        />
        {rows.length ? (
          <>
            <div className="fr-csv__row">
              <SegmentedControl<'sticky' | 'card'>
                aria-label="Import as"
                options={[
                  { value: 'card', label: 'Task cards' },
                  { value: 'sticky', label: 'Stickies' },
                ]}
                value={as}
                onChange={setAs}
              />
              <SegmentedControl<'grid' | 'kanban'>
                aria-label="Layout"
                options={[
                  { value: 'grid', label: 'Grid' },
                  { value: 'kanban', label: 'Kanban by status' },
                ]}
                value={layout}
                onChange={setLayout}
              />
              <Toggle size="sm" label="First row is a header" checked={hasHeader} onChange={setHasHeader} />
            </div>
            <div className="fr-csv__mapping" role="group" aria-label="Columns">
              {fields.map((f) => (
                <label key={f.field} className="fr-csv__map">
                  <span>{f.label}</span>
                  <Select<number>
                    aria-label={`Column for ${f.label}`}
                    size="sm"
                    options={columnOptions}
                    value={mapping[f.field] ?? NONE}
                    onChange={(v) => setMapping((m) => ({ ...m, [f.field as Field]: v === NONE ? undefined : v }))}
                  />
                </label>
              ))}
            </div>
            <p className="fr-csv__hint">
              {body.length} {body.length === 1 ? 'row' : 'rows'}
              {body.length > MAX_ROWS ? ` (the first ${MAX_ROWS} are imported)` : ''} · {items.length} with text
              {mapping.assignee !== undefined && as === 'card' ? ' · assignees are matched to board members by name' : ''}
            </p>
            <div className="fr-csv__preview" aria-label="Preview">
              <table>
                <thead>
                  <tr>{header.slice(0, width).map((h, i) => <th key={i}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {body.slice(0, 4).map((r, i) => (
                    <tr key={i}>
                      {header.slice(0, width).map((_, j) => (
                        <td key={j}>{r[j] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        {error ? (
          <p className="fr-csv__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export default definePanel({ id: CSV_IMPORT_DIALOG, slot: 'dialog', order: 91, Component: ImportDialog });
