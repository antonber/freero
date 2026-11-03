// The View panel (dock): how the tab I look at shows a kanban's cards. On the Board tab, which
// fields show (and their order), what colours cards and the filter are this person's own until an
// editor presses "Save for everyone"; viewers change them for themselves too. Grouping (columns,
// swimlanes), sorting and density move or resize the real cards on the shared board, so only
// editors change them, for everyone — and nobody but whoever locked it (and the board's owners)
// while the view is locked. On a table tab, its columns, filter and sort are mine until saved
// (step 3a), and so are a list's, a calendar's or a timeline's settings (3b). "Save for everyone"
// also makes the tab I look at the one everyone starts on.
// Shows the kanban the selection points at, and keeps showing it when the selection moves elsewhere.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Lock, SlidersHorizontal } from 'lucide-react';
import {
  MY_TAB_KEY,
  SHOWABLE_BUILTINS,
  boardView,
  collectionSchema,
  colorableFields,
  overrideBetween,
  savedTabId,
  shownTabId,
  calendarDateField,
  dateFields,
  listColumns,
  listGroupField,
  projectionGroupFields,
  projectionView,
  tableColumns,
  timelineFields,
  withOverride,
  type CardColorBy,
  type CardDensity,
  type KanbanElement,
  type ProjectionView,
  type TimelineScale,
} from '@freero/shared';
import { DockHeader, richTextToPlain, useCanEdit, useElement, usePeople, usePersonalView, useSelection, type Editor } from '@engine';
import { Button, IconButton, SegmentedControl, Select, Toggle } from '@ui';
import { fieldsTarget, FIELD_TYPE_LABELS } from './schema';
import { groupableFields, setGroupBy, setSwimlanes } from './group';
import { hasOwnView, resetMyView, saveViewForEveryone, setDensity, setMyCardDisplay, setViewLocked, viewEditable } from './view';
import { FilterRules, FilterSection, SortRules, SortSection } from './FilterSort';
import { myView, setMyView, tabsEditable } from './tabs';

const DENSITIES: Array<{ value: CardDensity; label: string }> = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
];

export function ViewPanel({ editor }: { editor: Editor }) {
  const selection = useSelection();
  const canEdit = useCanEdit();
  const [kid, setKid] = useState<string | null>(() => fieldsTarget(editor)?.id ?? null);
  useEffect(() => {
    const t = fieldsTarget(editor);
    if (t) setKid(t.id);
  }, [editor, selection]);
  const found = useElement(kid);
  const k = found?.type === 'kanban' ? (found as KanbanElement) : null;
  const saved = k ? boardView(k) : null;
  const override = usePersonalView(k?.id, saved?.id ?? '');
  const tabChoice = usePersonalView(k?.id, MY_TAB_KEY);
  const locker = usePeople(saved?.locked ? [saved.locked.by] : []);
  const tabId = k ? shownTabId(k, tabChoice) : null;
  const projection = k && tabId ? projectionView(k, tabId) : null;
  if (k && projection) return <ProjectionPanel editor={editor} k={k} saved={projection} />;
  if (!k || !saved) {
    return (
      <div className="fr-kanban-fields">
        <DockHeader className="fr-kanban-fields__head">
          <h2 className="fr-kanban-fields__title">View</h2>
        </DockHeader>
        <div className="fr-kanban-fields__empty">
          <SlidersHorizontal size={28} strokeWidth={1.5} aria-hidden />
          <strong>Select a kanban board</strong>
          <span>Choose what its cards show and how they are coloured.</span>
        </div>
      </div>
    );
  }
  const mine = withOverride(saved, override);
  // Mine: my changes to the board view, or a tab of my own (the board while everyone starts on a table).
  const own = !!overrideBetween(saved, mine) || tabId !== savedTabId(k);
  const schema = collectionSchema(k);
  const card = mine.card!;
  // Saving for everyone: editors, an unlocked kanban, a view nobody else locked.
  const mayShare = canEdit && viewEditable(editor, k);
  const lockedByOther = !!saved.locked && canEdit && !k.locked && !mayShare;
  const lockedBy = saved.locked ? (saved.locked.by === editor.user.id ? 'you' : (locker[saved.locked.by]?.name ?? 'someone')) : '';
  // Every field a card can show: the ones shown first, in their order, then the rest.
  const all = [...SHOWABLE_BUILTINS.map((f) => ({ id: f.id as string, name: f.name })), ...schema.map((f) => ({ id: f.id, name: f.name }))];
  const shown = card.show.map((id) => all.find((f) => f.id === id)).filter((f): f is { id: string; name: string } => !!f);
  const rest = all.filter((f) => !card.show.includes(f.id));
  const setShow = (show: string[]) => setMyCardDisplay(editor, k.id, { show });
  const groupBy = saved.groupBy ?? 'stage';
  const groupName = schema.find((f) => f.id === groupBy)?.name ?? 'Stage';
  const colorChoices: Array<{ value: CardColorBy; label: string }> = [
    { value: 'group', label: `Column (${groupName})` },
    { value: 'own', label: 'Card’s own colour' },
    { value: '$status', label: 'Status' },
    ...colorableFields(schema, groupBy).map((f) => ({ value: f.id, label: f.name })),
  ];
  const groupable = groupableFields(k);
  const groupChoices = groupable.map((f) => ({ value: f.id, label: `${f.name} (${FIELD_TYPE_LABELS[f.type].toLowerCase()})` }));
  const NONE = '';
  const laneChoices = [{ value: NONE, label: 'None' }, ...groupChoices.filter((c) => c.value !== groupBy)];

  return (
    <div className="fr-kanban-fields fr-kanban-view">
      <DockHeader className="fr-kanban-fields__head">
        <h2 className="fr-kanban-fields__title">View</h2>
        <span className="fr-kanban-fields__of">{richTextToPlain(k.title) || 'Kanban'}</span>
      </DockHeader>
      <Whose editor={editor} k={k} own={own} mayShare={mayShare} />
      {canEdit && !k.locked && (
        <div className={`fr-kanban-view__lock${saved.locked ? ' is-locked' : ''}`}>
          {lockedByOther ? (
            <>
              <Lock size={14} aria-hidden />
              <span>Locked by {lockedBy}: the view stays as saved. You can still change it for yourself.</span>
            </>
          ) : (
            <Toggle
              size="sm"
              checked={!!saved.locked}
              label={saved.locked ? `View locked by ${lockedBy}` : 'Lock this view'}
              onChange={(on) => setViewLocked(editor, k.id, on)}
            />
          )}
        </div>
      )}

      <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-groups">
        <h3 id="fr-kanban-view-groups" className="fr-kanban-view__heading">
          Columns
        </h3>
        <label className="fr-kanban-view__row">
          <span>Group by</span>
          {mayShare ? (
            <Select size="sm" aria-label="Group cards by" value={groupBy} options={groupChoices} onChange={(id) => setGroupBy(editor, k.id, id)} />
          ) : (
            <span className="fr-kanban-view__value">{groupName}</span>
          )}
        </label>
        <label className="fr-kanban-view__row">
          <span>Swimlanes</span>
          {mayShare ? (
            <Select size="sm" aria-label="Swimlanes by" value={saved.subGroupBy ?? NONE} options={laneChoices} onChange={(id) => setSwimlanes(editor, k.id, id || null)} />
          ) : (
            <span className="fr-kanban-view__value">{schema.find((f) => f.id === saved.subGroupBy)?.name ?? 'None'}</span>
          )}
        </label>
        <p className="fr-kanban-fields__hint">
          {mayShare
            ? 'Grouping moves the cards on the board, so it changes for everyone. A single select, person or checkbox field can make the columns or the rows.'
            : lockedByOther
              ? 'The view is locked: its grouping stays as saved.'
              : 'The board’s editors choose how its cards are grouped.'}
        </p>
      </section>

      <FilterSection editor={editor} k={k} schema={schema} mine={mine.filter ?? null} saved={saved.filter ?? null} mayShare={mayShare} />

      <SortSection editor={editor} k={k} schema={schema} sort={saved.sort ?? []} mayShare={mayShare} />

      <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-cards">
        <h3 id="fr-kanban-view-cards" className="fr-kanban-view__heading">
          Cards
        </h3>
        <label className="fr-kanban-view__row">
          <span>Density</span>
          {mayShare ? (
            <SegmentedControl size="sm" aria-label="Card density" value={card.density} options={DENSITIES} onChange={(d) => setDensity(editor, k.id, d)} />
          ) : (
            <span className="fr-kanban-view__value">{DENSITIES.find((d) => d.value === card.density)?.label}</span>
          )}
        </label>
        <p className="fr-kanban-fields__hint">{mayShare ? 'Density changes card sizes for everyone.' : 'Density is set by the board’s editors.'}</p>
        <label className="fr-kanban-view__row">
          <span>Colour by</span>
          <Select<CardColorBy>
            size="sm"
            aria-label="Colour cards by"
            // Coloured by the field the board is now grouped by = coloured by column.
            value={card.color === groupBy ? 'group' : colorChoices.some((c) => c.value === card.color) ? card.color : 'own'}
            options={colorChoices}
            onChange={(color) => setMyCardDisplay(editor, k.id, { color })}
          />
        </label>
      </section>

      <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-fields">
        <h3 id="fr-kanban-view-fields" className="fr-kanban-view__heading">
          Fields on cards
        </h3>
        <ol className="fr-kanban-fields__list fr-kanban-view__fields" aria-label="Fields on cards">
          {shown.map((f, i) => (
            <li key={f.id} className="fr-kanban-view__field">
              <Toggle size="sm" checked label={f.name} onChange={() => setShow(card.show.filter((id) => id !== f.id))} />
              <span className="fr-kanban-view__move">
                <IconButton
                  icon={ChevronUp}
                  size={32}
                  label={`Show ${f.name} earlier`}
                  disabled={i === 0}
                  onClick={() => setShow(swap(shown.map((x) => x.id), i, i - 1))}
                />
                <IconButton
                  icon={ChevronDown}
                  size={32}
                  label={`Show ${f.name} later`}
                  disabled={i === shown.length - 1}
                  onClick={() => setShow(swap(shown.map((x) => x.id), i, i + 1))}
                />
              </span>
            </li>
          ))}
          {rest.map((f) => (
            <li key={f.id} className="fr-kanban-view__field">
              <Toggle size="sm" checked={false} label={f.name} onChange={() => setShow([...shown.map((x) => x.id), f.id])} />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** "Only you see these changes · Save for everyone · Reset", or who sees what when nothing is mine. */
function Whose({ editor, k, own, mayShare }: { editor: Editor; k: KanbanElement; own: boolean; mayShare: boolean }) {
  return (
    <div className={`fr-kanban-view__whose${own ? ' is-own' : ''}`} role="status">
      {own ? (
        <>
          <span>Only you see these changes.</span>
          <span className="fr-kanban-view__whose-actions">
            {mayShare && (
              <Button size="sm" variant="primary" onClick={() => saveViewForEveryone(editor, k.id)}>
                Save for everyone
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => resetMyView(editor, k.id)}>
              Reset
            </Button>
          </span>
        </>
      ) : (
        <span>{mayShare ? 'Everyone sees this view. Your changes stay yours until you save them.' : 'Changes you make here are yours alone.'}</span>
      )}
    </div>
  );
}

const SCALE_CHOICES: Array<{ value: TimelineScale; label: string }> = [
  { value: 'day', label: 'Days' },
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
  { value: 'quarter', label: 'Quarters' },
];

/**
 * A projection tab's settings (a table, list, calendar or timeline): its filter and sort; a
 * table's or a list's columns, a list's grouping, the date fields a calendar or a timeline places
 * cards by, a timeline's scale and swimlanes. All mine until I save them for everyone — and since
 * a projection moves no real card, its filter really leaves cards out and its sort really orders
 * them, for me alone.
 */
function ProjectionPanel({ editor, k, saved }: { editor: Editor; k: KanbanElement; saved: ProjectionView }) {
  const canEdit = useCanEdit();
  usePersonalView(k.id, saved.id);
  const mine = myView(editor, k, saved.id) ?? saved;
  const schema = collectionSchema(k);
  const own = hasOwnView(editor, k);
  const mayShare = canEdit && tabsEditable(editor, k, { id: saved.id, name: saved.name, layout: saved.layout });
  const set = (patch: Record<string, unknown>) => setMyView(editor, k.id, saved.id, patch);
  const noun = saved.layout === 'table' || saved.layout === 'list' ? 'rows' : 'cards';
  const NONE = '';
  const dates = dateFields(schema).map((f) => ({ value: f.id, label: f.name }));
  const groups = projectionGroupFields(schema).map((f) => ({ value: f.id, label: f.name }));
  return (
    <div className="fr-kanban-fields fr-kanban-view">
      <DockHeader className="fr-kanban-fields__head">
        <h2 className="fr-kanban-fields__title">View</h2>
        <span className="fr-kanban-fields__of">
          {richTextToPlain(k.title) || 'Kanban'} · {saved.name}
        </span>
      </DockHeader>
      <Whose editor={editor} k={k} own={own} mayShare={mayShare} />
      {mine.layout === 'calendar' && (
        <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-dates">
          <h3 id="fr-kanban-view-dates" className="fr-kanban-view__heading">
            Dates
          </h3>
          <label className="fr-kanban-view__row">
            <span>Cards sit on</span>
            <Select size="sm" aria-label="Date field the calendar places cards on" value={calendarDateField(mine, schema)} options={dates} onChange={(date) => set({ date })} />
          </label>
          <p className="fr-kanban-fields__hint">Dragging a card to a day sets this date. A date field of the kanban works too.</p>
        </section>
      )}
      {mine.layout === 'timeline' && (
        <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-dates">
          <h3 id="fr-kanban-view-dates" className="fr-kanban-view__heading">
            Bars
          </h3>
          <label className="fr-kanban-view__row">
            <span>Start</span>
            <Select size="sm" aria-label="Where bars start" value={timelineFields(mine, schema).start} options={dates} onChange={(start) => set({ start })} />
          </label>
          <label className="fr-kanban-view__row">
            <span>End</span>
            <Select size="sm" aria-label="Where bars end" value={timelineFields(mine, schema).end} options={dates} onChange={(end) => set({ end })} />
          </label>
          <label className="fr-kanban-view__row">
            <span>Scale</span>
            <Select<TimelineScale> size="sm" aria-label="Timeline scale" value={timelineFields(mine, schema).scale} options={SCALE_CHOICES} onChange={(scale) => set({ scale })} />
          </label>
          <label className="fr-kanban-view__row">
            <span>Swimlanes</span>
            <Select size="sm" aria-label="Swimlanes by" value={timelineFields(mine, schema).lanes?.id ?? NONE} options={[{ value: NONE, label: 'None' }, ...groups]} onChange={(id) => set({ lanesBy: id || null })} />
          </label>
          <p className="fr-kanban-fields__hint">Dragging a bar moves both dates; dragging an end changes that one.</p>
        </section>
      )}
      {mine.layout === 'list' && (
        <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-group">
          <h3 id="fr-kanban-view-group" className="fr-kanban-view__heading">
            Groups
          </h3>
          <label className="fr-kanban-view__row">
            <span>Group by</span>
            <Select size="sm" aria-label="Group the list by" value={listGroupField(k, mine, schema)?.id ?? NONE} options={[{ value: NONE, label: 'Nothing' }, ...groups]} onChange={(id) => set({ groupBy: id || null })} />
          </label>
          <p className="fr-kanban-fields__hint">Alt + ↑ / ↓ on a row moves the card to the group above or below.</p>
        </section>
      )}
      <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-filter">
        <h3 id="fr-kanban-view-filter" className="fr-kanban-view__heading">
          Filter
        </h3>
        <FilterRules k={k} schema={schema} filter={mine.filter ?? null} onChange={(filter) => set({ filter })} />
        <p className="fr-kanban-fields__hint">Leaves {noun} out of this tab only: the board and its cards don’t change.</p>
      </section>
      <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-sort">
        <h3 id="fr-kanban-view-sort" className="fr-kanban-view__heading">
          Sort
        </h3>
        <SortRules schema={schema} sort={mine.sort ?? []} noun={noun} onChange={(sort) => set({ sort })} />
        <p className="fr-kanban-fields__hint">
          {mine.layout === 'timeline'
            ? 'Without a sort, bars are in order of their start.'
            : mine.layout === 'calendar'
              ? 'Orders the cards within each day.'
              : 'Without a sort, rows follow the board: column by column, top to bottom.'}
        </p>
      </section>
      {(mine.layout === 'table' || mine.layout === 'list') && <ColumnsSection k={k} schema={schema} shown={mine.layout === 'table' ? tableColumns(mine, schema) : listColumns(k, mine, schema)} onChange={(columns) => set({ columns })} list={mine.layout === 'list'} />}
    </div>
  );
}

/** Which fields a table or a list shows after the title, in order. */
function ColumnsSection({ schema, shown, onChange, list }: { k: KanbanElement; schema: ReturnType<typeof collectionSchema>; shown: string[]; onChange: (columns: string[]) => void; list: boolean }) {
  const all = [...SHOWABLE_BUILTINS.map((f) => ({ id: f.id as string, name: f.name })), ...schema.map((f) => ({ id: f.id, name: f.name }))];
  const name = (id: string) => all.find((f) => f.id === id)?.name ?? id;
  const setColumns = onChange;
  return (
    <>
      <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-columns">
        <h3 id="fr-kanban-view-columns" className="fr-kanban-view__heading">
          {list ? 'Fields on rows' : 'Columns'}
        </h3>
        <ol className="fr-kanban-fields__list fr-kanban-view__fields" aria-label={list ? 'Fields on the list’s rows' : 'Columns of the table'}>
          {shown.map((id, i) => (
            <li key={id} className="fr-kanban-view__field">
              <Toggle size="sm" checked label={name(id)} onChange={() => setColumns(shown.filter((x) => x !== id))} />
              <span className="fr-kanban-view__move">
                <IconButton icon={ChevronUp} size={32} label={`Move ${name(id)} left`} disabled={i === 0} onClick={() => setColumns(swap(shown, i, i - 1))} />
                <IconButton icon={ChevronDown} size={32} label={`Move ${name(id)} right`} disabled={i === shown.length - 1} onClick={() => setColumns(swap(shown, i, i + 1))} />
              </span>
            </li>
          ))}
          {all
            .filter((f) => !shown.includes(f.id))
            .map((f) => (
              <li key={f.id} className="fr-kanban-view__field">
                <Toggle size="sm" checked={false} label={f.name} onChange={() => setColumns([...shown, f.id])} />
              </li>
            ))}
        </ol>
      </section>
    </>
  );
}

function swap(ids: string[], i: number, j: number): string[] {
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
