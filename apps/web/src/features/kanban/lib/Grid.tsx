// The kanban's cards as a grid (step 3a): a table tab on the canvas and focus mode draw it. Real
// DOM rows and cells (`role="grid"`, the title of each row its row header), one tab stop: arrow
// keys walk the cells, Home / End and Page Up / Down jump, Enter (or F2, or a click on the active
// cell) edits, Escape cancels an edit. Windowed: only the rows in view are drawn (`aria-rowcount`
// tells screen readers how many there are), so 5,000 cards cost the rows on screen. Every edit is
// one card.setValues (lib/table.ts `writeCell`): one undo step, live for everyone.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { COLUMN_FIELD_ID, groupFieldId, richTextToPlain, type CardElement, type FieldDef, type FieldValue, type KanbanElement } from '@freero/shared';
import type { Editor } from '@engine';
import { Menu, type MenuItem } from '@ui';
import { cellOptions, cellText, cellValue, writeCell, type GridColumn } from './table';
import { useKanbanPeople } from './people';

export type GridEntry =
  | { kind: 'group'; key: string; title: string; count: number; color?: string }
  | { kind: 'card'; card: CardElement };

export interface GridApi {
  /** Scrolls entry `i` (a group header, say) to the top. */
  scrollTo(i: number): void;
}

export interface GridProps {
  editor: Editor;
  k: KanbanElement;
  schema: readonly FieldDef[];
  entries: readonly GridEntry[];
  columns: readonly GridColumn[];
  /** Cells can be edited (an editor, an unlocked card). */
  canEdit: boolean;
  rowH: number;
  /** Titles get a line of their description under them (comfortable rows). */
  descriptions?: boolean;
  label: string;
  /** Takes pointer, wheel and keys (on the canvas: while its kanban is selected). */
  interactive: boolean;
  /**
   * The part of the grid's scroll viewport on screen, px from its top (on the canvas, the part of
   * the kanban in the window); default all of it. Rows outside it aren't drawn.
   */
  clip?: { top: number; bottom: number } | null;
  /** The viewport's height when it can't be measured (before layout; tests). */
  height?: number;
  className?: string;
  api?: MutableRefObject<GridApi | null>;
  /** Shown instead of rows when there are none. */
  empty?: ReactNode;
}

/** Rows drawn beyond the visible ones, above and below (keyboard moves land on drawn rows). */
const OVERSCAN = 6;

type Cell = { row: number; col: number };
/** No cell marked active: a grid that doesn't take keys (an unselected kanban's table). */
const NO_CELL: Cell = { row: -1, col: -1 };

const isCard = (e: GridEntry | undefined): e is Extract<GridEntry, { kind: 'card' }> => e?.kind === 'card';

function Chips({ col, value }: { col: GridColumn; value: FieldValue | null }) {
  return (
    <span className="fr-kanban-grid__chips">
      {cellOptions(col, value).map((o) => (
        <span key={o.id} className="fr-kanban-grid__chip" style={{ ['--opt' as string]: o.color }}>
          <span className="fr-kanban-grid__dot" aria-hidden />
          {o.label || 'Untitled'}
        </span>
      ))}
    </span>
  );
}

/** A text, number, date or link cell being typed in: written on Enter, Tab or leaving it; Escape keeps the card as it was. */
function TextEditor({ col, initial, onDone }: { col: GridColumn; initial: string; onDone: (value: string | null, then: 'stay' | 'next' | 'prev' | 'cancel') => void }) {
  const [draft, setDraft] = useState(initial);
  const done = useRef(false);
  const finish = (then: 'stay' | 'next' | 'prev' | 'cancel') => {
    if (done.current) return;
    done.current = true;
    onDone(then === 'cancel' ? null : draft, then);
  };
  return (
    <input
      className="fr-kanban-grid__input"
      aria-label={col.name}
      autoFocus
      type={col.type === 'date' ? 'date' : 'text'}
      inputMode={col.type === 'number' ? 'decimal' : undefined}
      value={draft}
      onFocus={(e) => col.type !== 'date' && e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish('stay')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish('stay');
        } else if (e.key === 'Escape') {
          // Handled here: the dialog around the grid stays open, the board keeps its selection.
          e.preventDefault();
          e.stopPropagation();
          finish('cancel');
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finish(e.shiftKey ? 'prev' : 'next');
        }
        e.stopPropagation();
      }}
    />
  );
}

interface RowProps {
  editor: Editor;
  k: KanbanElement;
  schema: readonly FieldDef[];
  entry: GridEntry;
  index: number;
  columns: readonly GridColumn[];
  top: number;
  rowH: number;
  width: number;
  descriptions: boolean;
  active: Cell;
  editing: Cell | null;
  canEdit: boolean;
  personName: (id: string) => string | undefined;
  onCell: (cell: Cell, how: 'click' | 'dblclick') => void;
  onEditDone: (value: string | null, then: 'stay' | 'next' | 'prev' | 'cancel') => void;
  cellRef: (row: number, col: number, el: HTMLElement | null) => void;
}

const GridRow = memo(function GridRow(p: RowProps) {
  const { entry, index, columns } = p;
  if (entry.kind === 'group')
    return (
      <div role="row" aria-rowindex={index + 2} className="fr-kanban-grid__row is-group" style={{ top: p.top, height: p.rowH, width: p.width }}>
        <div role="rowheader" aria-colspan={columns.length} className="fr-kanban-grid__group" style={{ ['--opt' as string]: entry.color ?? 'var(--fr-ink-3)' }}>
          <span className="fr-kanban-grid__dot" aria-hidden />
          <span className="fr-kanban-grid__group-title">{entry.title}</span>
          <span className="fr-kanban-grid__count">
            {entry.count}
            <span className="fr-sr-only"> {entry.count === 1 ? 'card' : 'cards'}</span>
          </span>
        </div>
      </div>
    );
  const card = entry.card;
  const locked = !!card.locked;
  return (
    <div role="row" aria-rowindex={index + 2} className={`fr-kanban-grid__row${locked ? ' is-locked' : ''}`} style={{ top: p.top, height: p.rowH, width: p.width }}>
      {columns.map((col, c) => {
        const value = cellValue(p.k, card, col, p.schema);
        const isActive = p.active.row === index && p.active.col === c;
        const isEditing = !!p.editing && p.editing.row === index && p.editing.col === c;
        const text = cellText(col, value, p.personName);
        const editable = p.canEdit && !locked && !col.readOnly;
        let content: ReactNode;
        if (isEditing && (col.type === 'text' || col.type === 'url' || col.type === 'number' || col.type === 'date')) {
          content = <TextEditor col={col} initial={col.id === '$title' ? richTextToPlain(card.title) : value === null ? '' : String(value)} onDone={p.onEditDone} />;
        } else if (col.type === 'select' || col.type === 'multiselect') {
          content = <Chips col={col} value={value} />;
        } else if (col.type === 'checkbox') {
          content = (
            <span className={`fr-kanban-grid__check${value === true ? ' is-on' : ''}`}>
              {value === true && <Check size={14} strokeWidth={3} aria-hidden />}
              <span className="fr-sr-only">{value === true ? 'Checked' : 'Not checked'}</span>
            </span>
          );
        } else if (col.id === '$title') {
          const desc = p.descriptions ? richTextToPlain(card.description ?? '').split('\n')[0] : '';
          content = (
            <span className="fr-kanban-grid__title">
              <span className={text ? undefined : 'is-empty'}>{text || 'Untitled'}</span>
              {desc && <span className="fr-kanban-grid__desc">{desc}</span>}
            </span>
          );
        } else content = <span className="fr-kanban-grid__text">{text}</span>;
        return (
          <div
            key={col.id}
            ref={(el) => p.cellRef(index, c, el)}
            role={c === 0 ? 'rowheader' : 'gridcell'}
            aria-colindex={c + 1}
            aria-readonly={editable ? undefined : true}
            tabIndex={isActive && !isEditing ? 0 : -1}
            data-row={index}
            data-col={c}
            className={`fr-kanban-grid__cell${isActive ? ' is-active' : ''}${isEditing ? ' is-editing' : ''}`}
            style={{ width: col.width }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => p.onCell({ row: index, col: c }, 'click')}
            onDoubleClick={() => p.onCell({ row: index, col: c }, 'dblclick')}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
});

export function Grid(props: GridProps) {
  const { editor, k, schema, entries, columns, rowH, canEdit } = props;
  const scroll = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  const [scrollTop, setScrollTop] = useState(0);
  const [measured, setMeasured] = useState(0);
  const firstCard = Math.max(0, entries.findIndex(isCard));
  const [active, setActive] = useState<Cell>({ row: firstCard, col: 0 });
  const [editing, setEditing] = useState<Cell | null>(null);
  // Focus follows a keyboard move once the row it lands on is drawn.
  const wantFocus = useRef(false);
  const people = useKanbanPeople(editor);
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const personName = useMemo(() => (id: string) => names.get(id), [names]);
  const width = columns.reduce((s, c) => s + c.width, 0);
  const headH = rowH >= 44 ? 40 : 34;

  // Rows come and go (a filter, a remote delete): the active cell stays on a card in range.
  const row = Math.min(active.row, Math.max(0, entries.length - 1));
  const at: Cell = { row: isCard(entries[row]) ? row : nextCard(entries, row, 1) ?? nextCard(entries, row, -1) ?? 0, col: Math.min(active.col, columns.length - 1) };

  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const measure = () => setMeasured(el.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const viewH = measured || props.height || 600;
  // What is on screen, in body coordinates (below the header row).
  const clipTop = props.clip ? Math.max(0, props.clip.top) : 0;
  const clipBottom = props.clip ? Math.min(viewH, props.clip.bottom) : viewH;
  const top = scrollTop + clipTop - headH;
  const bottom = scrollTop + clipBottom - headH;
  const first = Math.max(0, Math.floor(top / rowH) - OVERSCAN);
  const last = Math.min(entries.length - 1, Math.ceil(bottom / rowH) + OVERSCAN);
  const pageRows = Math.max(1, Math.floor((viewH - headH) / rowH) - 1);

  if (props.api)
    props.api.current = {
      scrollTo: (i) => {
        if (scroll.current) scroll.current.scrollTop = i * rowH;
        setScrollTop(i * rowH);
      },
    };

  /** Scrolls cell `c` into the viewport (rows below the sticky header, columns sideways). */
  const reveal = (c: Cell) => {
    const el = scroll.current;
    if (!el) return;
    const rowTop = c.row * rowH;
    if (rowTop < el.scrollTop) el.scrollTop = rowTop;
    else if (rowTop + rowH > el.scrollTop + viewH - headH) el.scrollTop = rowTop + rowH - (viewH - headH);
    const left = columns.slice(0, c.col).reduce((s, x) => s + x.width, 0);
    const right = left + columns[c.col].width;
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (right > el.scrollLeft + el.clientWidth && el.clientWidth) el.scrollLeft = right - el.clientWidth;
    setScrollTop(el.scrollTop);
  };

  const moveTo = (c: Cell) => {
    setActive(c);
    reveal(c);
    wantFocus.current = true;
  };

  useEffect(() => {
    if (!wantFocus.current || editing) return;
    const el = cells.current.get(`${at.row}:${at.col}`);
    if (el) {
      wantFocus.current = false;
      el.focus({ preventScroll: true });
    }
  });

  const startEdit = (c: Cell) => {
    const entry = entries[c.row];
    const col = columns[c.col];
    if (!isCard(entry) || !col || !canEdit || entry.card.locked || col.readOnly) return;
    if (col.type === 'checkbox') {
      writeCell(editor, entry.card, col, cellValue(k, entry.card, col, schema) === true ? null : true);
      return;
    }
    setEditing(c);
  };

  const onEditDone = (value: string | null, then: 'stay' | 'next' | 'prev' | 'cancel') => {
    const c = editing;
    setEditing(null);
    if (!c) return;
    const entry = entries[c.row];
    if (then !== 'cancel' && value !== null && isCard(entry)) {
      const col = columns[c.col];
      const cur = cellValue(k, entry.card, col, schema);
      if (value.trim() !== (cur === null ? '' : String(cur)).trim()) writeCell(editor, entry.card, col, value);
    }
    const next = then === 'next' ? { row: c.row, col: Math.min(columns.length - 1, c.col + 1) } : then === 'prev' ? { row: c.row, col: Math.max(0, c.col - 1) } : c;
    moveTo(next);
  };

  const onCell = (c: Cell, how: 'click' | 'dblclick') => {
    if (!props.interactive) return;
    const wasActive = at.row === c.row && at.col === c.col;
    setActive(c);
    wantFocus.current = !editing;
    if (how === 'dblclick' || wasActive || columns[c.col]?.type === 'checkbox') startEdit(c);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing || !props.interactive) return;
    const vertical = (dir: 1 | -1, steps = 1) => {
      let r = at.row;
      for (let i = 0; i < steps; i++) {
        const n = nextCard(entries, r, dir);
        if (n === null) break;
        r = n;
      }
      return r;
    };
    let next: Cell | null = null;
    switch (e.key) {
      case 'ArrowDown':
        next = { row: vertical(1), col: at.col };
        break;
      case 'ArrowUp':
        next = { row: vertical(-1), col: at.col };
        break;
      case 'ArrowRight':
        next = { row: at.row, col: Math.min(columns.length - 1, at.col + 1) };
        break;
      case 'ArrowLeft':
        next = { row: at.row, col: Math.max(0, at.col - 1) };
        break;
      case 'Home':
        next = e.ctrlKey || e.metaKey ? { row: firstCard, col: 0 } : { row: at.row, col: 0 };
        break;
      case 'End':
        next = e.ctrlKey || e.metaKey ? { row: nextCard(entries, entries.length, -1) ?? at.row, col: columns.length - 1 } : { row: at.row, col: columns.length - 1 };
        break;
      case 'PageDown':
        next = { row: vertical(1, pageRows), col: at.col };
        break;
      case 'PageUp':
        next = { row: vertical(-1, pageRows), col: at.col };
        break;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        e.stopPropagation();
        startEdit(at);
        return;
      case ' ':
        if (columns[at.col]?.type === 'checkbox') {
          e.preventDefault();
          startEdit(at);
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    moveTo(next);
  };

  // A choice cell being edited opens a menu of its options at the cell.
  const editEntry = editing ? entries[editing.row] : undefined;
  const editCol = editing ? columns[editing.col] : undefined;
  const choiceMenu =
    editing && isCard(editEntry) && editCol && (editCol.type === 'select' || editCol.type === 'multiselect' || editCol.type === 'person')
      ? choiceItems(editor, k, editEntry.card, editCol, schema, people)
      : null;

  const drawn: ReactNode[] = [];
  for (let i = first; i <= last; i++)
    drawn.push(
      <GridRow
        key={entries[i].kind === 'card' ? (entries[i] as { card: CardElement }).card.id : `g:${(entries[i] as { key: string }).key}`}
        editor={editor}
        k={k}
        schema={schema}
        entry={entries[i]}
        index={i}
        columns={columns}
        top={i * rowH}
        rowH={rowH}
        width={width}
        descriptions={!!props.descriptions}
        active={props.interactive ? at : NO_CELL}
        editing={editing}
        canEdit={canEdit}
        personName={personName}
        onCell={onCell}
        onEditDone={onEditDone}
        cellRef={(r, c, el) => {
          if (el) cells.current.set(`${r}:${c}`, el);
          else cells.current.delete(`${r}:${c}`);
        }}
      />,
    );
  const activeDrawn = at.row >= first && at.row <= last;

  return (
    <div
      ref={scroll}
      role="grid"
      aria-label={props.label}
      aria-rowcount={entries.length + 1}
      aria-colcount={columns.length}
      // While no row with the active cell is drawn (scrolled away) the grid itself is the tab stop.
      tabIndex={props.interactive && !activeDrawn ? 0 : -1}
      className={`fr-kanban-grid${props.interactive ? ' is-interactive' : ''}${props.className ? ` ${props.className}` : ''}`}
      {...(props.interactive ? { 'data-fr-interactive': '', 'data-fr-scrollable': '', 'data-fr-keyboard-trap': '' } : {})}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (e.target === e.currentTarget && entries.length) moveTo(at);
      }}
    >
      <div role="rowgroup" className="fr-kanban-grid__head" style={{ width, height: headH }}>
        <div role="row" aria-rowindex={1} className="fr-kanban-grid__head-row">
          {columns.map((c, i) => (
            <div key={c.id} role="columnheader" aria-colindex={i + 1} className="fr-kanban-grid__colhead" style={{ width: c.width }}>
              {c.name}
            </div>
          ))}
        </div>
      </div>
      <div role="rowgroup" className="fr-kanban-grid__body" style={{ width, height: Math.max(entries.length * rowH, 1) }}>
        {drawn}
      </div>
      {!entries.length && props.empty && <div className="fr-kanban-grid__empty">{props.empty}</div>}
      {choiceMenu && editing && (
        <Menu
          open
          anchor={cells.current.get(`${editing.row}:${editing.col}`) ?? null}
          items={choiceMenu}
          aria-label={editCol!.name}
          onClose={() => {
            setEditing(null);
            wantFocus.current = true;
          }}
        />
      )}
    </div>
  );
}

/** The next card entry from `i` in direction `dir` (skipping group rows), or null at the end. */
function nextCard(entries: readonly GridEntry[], i: number, dir: 1 | -1): number | null {
  for (let j = i + dir; j >= 0 && j < entries.length; j += dir) if (entries[j].kind === 'card') return j;
  return null;
}

/** A choice cell's menu: its options (a multi-select toggles one per pick), people for a person field. */
function choiceItems(editor: Editor, k: KanbanElement, card: CardElement, col: GridColumn, schema: readonly FieldDef[], people: ReadonlyArray<{ id: string; name: string }>): MenuItem[] {
  const value = cellValue(k, card, col, schema);
  const set = (v: FieldValue | null) => writeCell(editor, card, col, v);
  // Grouped by the column field, a card always has one: the column it is in.
  const required = col.id === COLUMN_FIELD_ID && groupFieldId(k) === COLUMN_FIELD_ID;
  if (col.type === 'person') {
    const known = typeof value !== 'string' || people.some((p) => p.id === value);
    return [
      { id: '~none', label: 'Nobody', checked: value === null, onSelect: () => set(null) },
      ...people.map((p) => ({ id: p.id, label: p.name, checked: value === p.id, onSelect: () => set(p.id) })),
      ...(known ? [] : [{ id: String(value), label: 'Someone who no longer has access', checked: true, onSelect: () => undefined }]),
    ];
  }
  const options = col.options ?? [];
  const label = (o: { label: string; color: string }) => (
    <span className="fr-kanban-grid__chip" style={{ ['--opt' as string]: o.color }}>
      <span className="fr-kanban-grid__dot" aria-hidden />
      {o.label || 'Untitled'}
    </span>
  );
  if (col.type === 'multiselect') {
    const on = new Set(Array.isArray(value) ? value : []);
    return options.map((o) => ({
      id: o.id,
      label: label(o),
      checked: on.has(o.id),
      onSelect: () => set(options.filter((x) => (x.id === o.id ? !on.has(o.id) : on.has(x.id))).map((x) => x.id)),
    }));
  }
  return [
    ...(required ? [] : [{ id: '~none', label: 'None', checked: value === null, onSelect: () => set(null) }]),
    ...options.map((o) => ({ id: o.id, label: label(o), checked: value === o.id, onSelect: () => set(o.id) })),
  ];
}
