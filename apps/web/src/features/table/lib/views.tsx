// Typed cells (KAI-123): how a number / date / select / person / checkbox cell is drawn and edited,
// the column menu (type, sort, filter, options) and the board view of the same rows.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Calendar,
  Check,
  CheckSquare,
  ChevronDown,
  CircleDot,
  Filter,
  Hash,
  ListChecks,
  Type,
  User,
  X,
} from 'lucide-react';
import type { TableColumn, TableColumnType, TableElement } from '@freero/shared';
import { type Editor, type HostUser } from '@engine';
import { Menu, Popover, type MenuItem } from '@ui';
import { COLUMN_TYPES, displayValue, isValid, optionOf, typeOf, valueFor, type PeopleLookup } from './columns';
import { addOption, BOARD, moveRowToGroup, patchOption, peopleLookup, removeOption, setColumnType, setFilter, sortByColumn } from './actions';

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

export const TYPE_ICONS: Record<TableColumnType, typeof Type> = {
  text: Type,
  number: Hash,
  date: Calendar,
  select: CircleDot,
  person: User,
  checkbox: CheckSquare,
};

/** A typed cell as it reads (not editing). */
export function TypedValue({
  col,
  raw,
  people,
  onToggle,
}: {
  col: TableColumn;
  raw: string;
  people: PeopleLookup;
  /** Checkbox cells of an editable table toggle on click. */
  onToggle?: () => void;
}) {
  const type = typeOf(col);
  if (type === 'checkbox')
    return (
      <div className="fr-table__typed is-checkbox">
        <button
          type="button"
          className={`fr-table__check${raw === 'true' ? ' is-on' : ''}`}
          role="checkbox"
          aria-checked={raw === 'true'}
          aria-label="Done"
          disabled={!onToggle}
          {...(onToggle ? { 'data-fr-interactive': '' } : {})}
          onPointerDown={onToggle ? stop : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
        >
          {raw === 'true' && <Check size={13} strokeWidth={3} aria-hidden />}
        </button>
      </div>
    );
  if (!raw) return null;
  if (!isValid(col, raw)) return <div className={`fr-table__typed is-${type} is-invalid`} title={`Not a ${type}`}>{displayValue(undefined, raw)}</div>;
  if (type === 'select') {
    const opt = optionOf(col, raw);
    return (
      <div className="fr-table__typed is-select">
        <span className={`fr-table__chip${opt ? '' : ' is-unknown'}`} style={{ background: opt?.color }}>
          {displayValue(col, raw)}
        </span>
      </div>
    );
  }
  if (type === 'person') {
    const name = people.name(raw);
    return (
      <div className="fr-table__typed is-person">
        <span className="fr-table__avatar" aria-hidden>
          {(name ?? '?').trim().charAt(0).toUpperCase()}
        </span>
        <span className="fr-table__person">{name ?? 'Unknown person'}</span>
      </div>
    );
  }
  return <div className={`fr-table__typed is-${type}`}>{displayValue(col, raw, people)}</div>;
}

type Commit = (raw: string, then?: 'stop' | 'next' | 'prev') => void;

/** The editor of a typed cell: a field for numbers and dates, a list for selects and people. */
export function TypedEditor({
  editor,
  table,
  col,
  raw,
  anchor,
  onCommit,
  onCancel,
}: {
  editor: Editor;
  table: TableElement;
  col: TableColumn;
  raw: string;
  anchor: HTMLElement | null;
  onCommit: Commit;
  onCancel: () => void;
}) {
  const type = typeOf(col);
  if (type === 'number' || type === 'date') return <FieldEditor type={type} col={col} raw={raw} onCommit={onCommit} onCancel={onCancel} />;
  if (type === 'checkbox') return <CheckboxEditor raw={raw} onCommit={onCommit} onCancel={onCancel} />;
  return <ListEditor editor={editor} table={table} col={col} raw={raw} anchor={anchor} onCommit={onCommit} onCancel={onCancel} />;
}

function keyMove(e: KeyboardEvent): 'stop' | 'next' | 'prev' | null {
  if (e.key === 'Enter') return 'stop';
  if (e.key === 'Tab') return e.shiftKey ? 'prev' : 'next';
  return null;
}

function FieldEditor({ type, col, raw, onCommit, onCancel }: { type: 'number' | 'date'; col: TableColumn; raw: string; onCommit: Commit; onCancel: () => void }) {
  const initial = type === 'date' && !isValid(col, raw) ? '' : displayValue(undefined, raw);
  const [value, setValue] = useState(initial);
  const valueRef = useRef(value);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    if (type === 'number') ref.current?.select();
    // Leaving the cell any other way (a click elsewhere) keeps what was typed.
    return () => {
      if (!done.current && valueRef.current !== initial) onCommit(valueFor(col, valueRef.current));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <input
      ref={ref}
      className={`fr-table__input is-${type}`}
      data-fr-interactive=""
      type={type === 'date' ? 'date' : 'text'}
      inputMode={type === 'number' ? 'decimal' : undefined}
      aria-label={type === 'date' ? 'Date' : 'Number'}
      value={value}
      onPointerDown={stop}
      onChange={(e) => {
        valueRef.current = e.target.value;
        setValue(e.target.value);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          done.current = true;
          onCancel();
          return;
        }
        const then = keyMove(e);
        if (!then) return;
        e.preventDefault();
        done.current = true;
        onCommit(valueFor(col, valueRef.current), then);
      }}
    />
  );
}

function CheckboxEditor({ raw, onCommit, onCancel }: { raw: string; onCommit: Commit; onCancel: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="fr-table__typed is-checkbox">
      <button
        ref={ref}
        type="button"
        className={`fr-table__check${raw === 'true' ? ' is-on' : ''}`}
        role="checkbox"
        aria-checked={raw === 'true'}
        aria-label="Done"
        data-fr-interactive=""
        onPointerDown={stop}
        onClick={() => onCommit(raw === 'true' ? '' : 'true')}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') return onCancel();
          if (e.key === ' ') {
            e.preventDefault();
            onCommit(raw === 'true' ? '' : 'true');
            return;
          }
          const then = keyMove(e);
          if (then) {
            e.preventDefault();
            onCommit(raw, then);
          }
        }}
      >
        {raw === 'true' && <Check size={13} strokeWidth={3} aria-hidden />}
      </button>
    </div>
  );
}

function ListEditor({
  editor,
  table,
  col,
  raw,
  anchor,
  onCommit,
  onCancel,
}: {
  editor: Editor;
  table: TableElement;
  col: TableColumn;
  raw: string;
  anchor: HTMLElement | null;
  onCommit: Commit;
  onCancel: () => void;
}) {
  const type = typeOf(col);
  const [members, setMembers] = useState<HostUser[] | null>(null);
  useEffect(() => {
    if (type !== 'person') return;
    let live = true;
    editor.host
      .listMembers()
      .then((m) => live && setMembers(m))
      .catch(() => live && setMembers([editor.host.user]));
    return () => {
      live = false;
    };
  }, [editor, type]);
  const chosen = useRef(false);
  const pick = (v: string) => {
    chosen.current = true;
    onCommit(v);
  };
  const items: MenuItem[] =
    type === 'select'
      ? [
          ...(col.options ?? []).map((o) => ({
            id: o.id,
            label: (
              <span className="fr-table__chip" style={{ background: o.color }}>
                {o.label}
              </span>
            ),
            checked: optionOf(col, raw)?.id === o.id,
            onSelect: () => pick(valueFor(col, o.label)),
          })),
          ...(col.options?.length ? [] : [{ heading: 'No options yet: add them from the column menu' }]),
        ]
      : members === null
        ? [{ heading: 'Loading people…' }]
        : members.map((m) => ({ id: m.id, label: m.name, checked: raw === m.id, onSelect: () => pick(m.id) }));
  if (raw) items.push({ divider: true }, { id: 'clear', label: 'Clear', icon: X, onSelect: () => pick('') });
  return (
    <Menu
      open={!!anchor}
      anchor={anchor}
      items={items}
      side="bottom"
      align="start"
      minWidth={Math.max(160, Math.min(260, table.cols.find((c) => c.id === col.id)?.w ?? 160))}
      aria-label={type === 'select' ? 'Choose an option' : 'Choose a person'}
      onClose={() => {
        if (!chosen.current) onCancel();
      }}
    />
  );
}

// ------------------------------------------------------------------ column menu

/** The ▾ button on a column's top cell: type, sort, filter, and a select column's options. */
export function ColumnMenu({ editor, table, col }: { editor: Editor; table: TableElement; col: TableColumn }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const type = typeOf(col);
  const sort = (dir: 'asc' | 'desc') => {
    void (type === 'person' ? peopleLookup(editor) : Promise.resolve(undefined)).then((people) => sortByColumn(editor, table.id, col.id, dir, people));
  };
  const items: MenuItem[] = [
    {
      id: 'type',
      label: `Type: ${COLUMN_TYPES.find((t) => t.value === type)?.label}`,
      icon: TYPE_ICONS[type],
      onSelect: () => undefined,
      submenu: COLUMN_TYPES.map((t) => ({ id: t.value, label: t.label, icon: TYPE_ICONS[t.value], checked: t.value === type, onSelect: () => void setColumnType(editor, table.id, col.id, t.value) })),
    },
    ...(type === 'select' ? [{ id: 'options', label: 'Edit options…', icon: ListChecks, onSelect: () => setOptions(true) }] : []),
    { divider: true },
    { id: 'asc', label: type === 'number' || type === 'date' ? 'Sort ascending' : 'Sort A → Z', icon: ArrowDownAZ, onSelect: () => sort('asc') },
    { id: 'desc', label: type === 'number' || type === 'date' ? 'Sort descending' : 'Sort Z → A', icon: ArrowUpAZ, onSelect: () => sort('desc') },
    table.filter?.colId === col.id
      ? { id: 'unfilter', label: 'Clear filter', icon: X, onSelect: () => setFilter(editor, table.id, null) }
      : {
          id: 'filter',
          label: type === 'checkbox' ? 'Show only checked' : 'Show only non-empty',
          icon: Filter,
          onSelect: () => setFilter(editor, table.id, { colId: col.id, op: type === 'checkbox' ? 'checked' : 'notEmpty' }),
        },
  ];
  const Icon = TYPE_ICONS[type];
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`fr-table__colmenu${open || options ? ' is-open' : ''}`}
        data-fr-interactive=""
        aria-label="Column options"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Column type, sort and filter"
        onPointerDown={stop}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {type !== 'text' && <Icon size={11} aria-hidden />}
        <ChevronDown size={12} aria-hidden />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} anchor={ref.current} items={items} aria-label="Column options" />
      {options && <OptionsEditor editor={editor} tableId={table.id} col={col} anchor={ref.current} onClose={() => setOptions(false)} />}
    </>
  );
}

function OptionsEditor({ editor, tableId, col, anchor, onClose }: { editor: Editor; tableId: string; col: TableColumn; anchor: HTMLElement | null; onClose: () => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    if (addOption(editor, tableId, col.id, draft)) setDraft('');
  };
  return (
    <Popover open onClose={onClose} anchor={anchor} side="bottom" offset={8} aria-label="Options">
      <div className="fr-table-options">
        <div className="fr-table-options__title">Options</div>
        {(col.options ?? []).map((o) => (
          <div key={o.id} className="fr-table-options__row">
            <span className="fr-table-options__swatch" style={{ background: o.color }} />
            <input
              className="fr-table-options__input"
              defaultValue={o.label}
              aria-label="Option name"
              onBlur={(e) => e.target.value.trim() !== o.label && patchOption(editor, tableId, col.id, o.id, { label: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <button type="button" className="fr-table-options__remove" aria-label={`Remove ${o.label}`} onClick={() => removeOption(editor, tableId, col.id, o.id)}>
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
        <div className="fr-table-options__row">
          <input
            className="fr-table-options__input"
            placeholder="Add an option"
            aria-label="New option"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
          />
        </div>
      </div>
    </Popover>
  );
}

// ------------------------------------------------------------------ board view

/**
 * The rows as cards in a column per option of `groupBy` (plus "No value"). Dragging a card to
 * another column sets its option: the same cell the grid shows.
 */
export function BoardView({
  editor,
  table,
  rows,
  get,
  people,
  interactive,
  zoom,
}: {
  editor: Editor;
  table: TableElement;
  rows: TableElement['rows'];
  get: (rowId: string, colId: string) => string;
  people: PeopleLookup;
  interactive: boolean;
  zoom: number;
}) {
  const group = table.cols.find((c) => c.id === table.groupBy && typeOf(c) === 'select');
  const [drag, setDrag] = useState<{ rowId: string; dx: number; dy: number; over: string | null } | null>(null);
  if (!group) return <div className="fr-table-board__empty">Add a select column to group the rows by.</div>;
  const headerRow = table.header ? table.rows[0] : null;
  const body = rows.filter((r) => r !== headerRow);
  const titleCol = table.cols.find((c) => typeOf(c) === 'text' && c.id !== group.id) ?? table.cols[0];
  const fields = table.cols.filter((c) => c.id !== group.id && c.id !== titleCol.id);
  const name = (c: TableColumn) => (headerRow ? displayValue(undefined, get(headerRow.id, c.id)) : '');
  const lanes = [...(group.options ?? []).map((o) => ({ key: o.label, label: o.label, color: o.color })), { key: '', label: 'No value', color: '#F1F0F5' }];
  const laneOf = (rowId: string) => optionOf(group, get(rowId, group.id))?.label ?? '';

  const startDrag = (e: ReactPointerEvent, rowId: string) => {
    if (!interactive || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const from = { x: e.clientX, y: e.clientY };
    const z = editor.getCamera().zoom || zoom;
    const target = e.currentTarget as HTMLElement;
    const root = target.closest('.fr-table-board');
    // By geometry: the board's world layer takes no pointer events, so hit-testing the DOM can't.
    const laneUnder = (x: number, y: number) => {
      for (const lane of root?.querySelectorAll<HTMLElement>('[data-fr-lane]') ?? []) {
        const r = lane.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return lane.getAttribute('data-fr-lane');
      }
      return null;
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      setDrag({ rowId, dx: (ev.clientX - from.x) / z, dy: (ev.clientY - from.y) / z, over: laneUnder(ev.clientX, ev.clientY) });
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      setDrag(null);
      if (ev.type !== 'pointerup' || !target.isConnected) return;
      const lane = laneUnder(ev.clientX, ev.clientY);
      if (lane !== null && lane !== laneOf(rowId)) moveRowToGroup(editor, table.id, rowId, group.id, lane);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  };

  return (
    <div className="fr-table-board" style={{ gap: BOARD.gap, padding: BOARD.gap }}>
      {lanes.map((lane) => {
        const cards = body.filter((r) => laneOf(r.id) === lane.key);
        return (
          <div key={lane.key || '∅'} className={`fr-table-board__lane${drag?.over === lane.key ? ' is-over' : ''}`} data-fr-lane={lane.key} style={{ width: BOARD.colW, ['--lane' as string]: lane.color }}>
            <div className="fr-table-board__head">
              <span className="fr-table__chip" style={{ background: lane.color }}>
                {lane.label}
              </span>
              <span className="fr-table-board__count">{cards.length}</span>
            </div>
            {cards.map((r) => {
              const moving = drag?.rowId === r.id;
              const shown = fields.filter((c) => (typeOf(c) === 'checkbox' ? get(r.id, c.id) === 'true' : !!get(r.id, c.id))).slice(0, 3);
              return (
                <div
                  key={r.id}
                  className={`fr-table-board__card${moving ? ' is-dragging' : ''}`}
                  style={{ minHeight: BOARD.cardH, transform: moving ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined }}
                  {...(interactive ? { 'data-fr-interactive': '' } : {})}
                  onPointerDown={(e) => startDrag(e, r.id)}
                >
                  <div className="fr-table-board__title">{displayValue(titleCol, get(r.id, titleCol.id), people) || 'Untitled'}</div>
                  {shown.map((c) => (
                    <div key={c.id} className="fr-table-board__field">
                      {name(c) && <span className="fr-table-board__label">{name(c)}</span>}
                      <span>{typeOf(c) === 'checkbox' ? '✓' : displayValue(c, get(r.id, c.id), people)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
