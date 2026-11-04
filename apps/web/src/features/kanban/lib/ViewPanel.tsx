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
  LAYOUT_NAMES,
  LINKED_VIEW_KEY,
  MY_TAB_KEY,
  PROJECTION_LAYOUTS,
  linkedView,
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
  type KanbanViewElement,
  type ProjectionLayout,
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
import { hasOwnLinkedView, linkedEditable, myLinkedView, renameLinkedView, resetMyLinkedView, saveLinkedViewForEveryone, selectedLinkedView, setLinkedLayout, setLinkedLocked, setMyLinkedView } from './linked';

import { t as tr } from '../messages';
const DENSITIES: Array<{ value: CardDensity; label: string }> = [
  { value: 'compact', label: tr('compact') },
  { value: 'comfortable', label: tr('comfortable') },
];

/** What the panel shows: a selected linked view (step 3c), else the kanban the selection points at. */
const viewTarget = (editor: Editor) => selectedLinkedView(editor)?.id ?? fieldsTarget(editor)?.id ?? null;

export function ViewPanel({ editor }: { editor: Editor }) {
  const selection = useSelection();
  const [id, setId] = useState<string | null>(() => viewTarget(editor));
  useEffect(() => {
    const t = viewTarget(editor);
    if (t) setId(t);
  }, [editor, selection]);
  const found = useElement(id);
  if (found?.type === 'kanbanview') return <LinkedViewPanel editor={editor} lv={found as KanbanViewElement} />;
  return <KanbanViewPanel editor={editor} k={found?.type === 'kanban' ? (found as KanbanElement) : null} />;
}

function KanbanViewPanel({ editor, k }: { editor: Editor; k: KanbanElement | null }) {
  const canEdit = useCanEdit();
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
          <h2 className="fr-kanban-fields__title">{tr('view')}</h2>
        </DockHeader>
        <div className="fr-kanban-fields__empty">
          <SlidersHorizontal size={28} strokeWidth={1.5} aria-hidden />
          <strong>{tr('selectAKanbanBoard')}</strong>
          <span>{tr('chooseWhatItsCardsShow')}</span>
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
    { value: 'group', label: tr('columnGroupname', { groupName }) },
    { value: 'own', label: tr('cardSOwnColour') },
    { value: '$status', label: tr('status') },
    ...colorableFields(schema, groupBy).map((f) => ({ value: f.id, label: f.name })),
  ];
  const groupable = groupableFields(k);
  const groupChoices = groupable.map((f) => ({ value: f.id, label: `${f.name} (${FIELD_TYPE_LABELS[f.type].toLowerCase()})` }));
  const NONE = '';
  const laneChoices = [{ value: NONE, label: tr('none') }, ...groupChoices.filter((c) => c.value !== groupBy)];

  return (
    <div className="fr-kanban-fields fr-kanban-view">
      <DockHeader className="fr-kanban-fields__head">
        <h2 className="fr-kanban-fields__title">{tr('view')}</h2>
        <span className="fr-kanban-fields__of">{richTextToPlain(k.title) || tr('kanban')}</span>
      </DockHeader>
      <Whose own={own} mayShare={mayShare} onSave={() => saveViewForEveryone(editor, k.id)} onReset={() => resetMyView(editor, k.id)} />
      {canEdit && !k.locked && (
        <div className={`fr-kanban-view__lock${saved.locked ? ' is-locked' : ''}`}>
          {lockedByOther ? (
            <>
              <Lock size={14} aria-hidden />
              <span>{tr('lockedByLockedbyTheView', { lockedBy })}</span>
            </>
          ) : (
            <Toggle
              size="sm"
              checked={!!saved.locked}
              label={saved.locked ? tr('viewLockedByLockedby', { lockedBy }) : tr('lockThisView')}
              onChange={(on) => setViewLocked(editor, k.id, on)}
            />
          )}
        </div>
      )}

      <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-groups">
        <h3 id="fr-kanban-view-groups" className="fr-kanban-view__heading">{tr('columns')}</h3>
        <label className="fr-kanban-view__row">
          <span>{tr('groupBy')}</span>
          {mayShare ? (
            <Select size="sm" aria-label={tr('groupCardsBy')} value={groupBy} options={groupChoices} onChange={(id) => setGroupBy(editor, k.id, id)} />
          ) : (
            <span className="fr-kanban-view__value">{groupName}</span>
          )}
        </label>
        <label className="fr-kanban-view__row">
          <span>{tr('swimlanes')}</span>
          {mayShare ? (
            <Select size="sm" aria-label={tr('swimlanesBy')} value={saved.subGroupBy ?? NONE} options={laneChoices} onChange={(id) => setSwimlanes(editor, k.id, id || null)} />
          ) : (
            <span className="fr-kanban-view__value">{schema.find((f) => f.id === saved.subGroupBy)?.name ?? tr('none')}</span>
          )}
        </label>
        <p className="fr-kanban-fields__hint">
          {mayShare
            ? tr('groupingMovesTheCardsOn')
            : lockedByOther
              ? tr('theViewIsLockedIts')
              : tr('theBoardSEditorsChoose')}
        </p>
      </section>

      <FilterSection editor={editor} k={k} schema={schema} mine={mine.filter ?? null} saved={saved.filter ?? null} mayShare={mayShare} />

      <SortSection editor={editor} k={k} schema={schema} sort={saved.sort ?? []} mayShare={mayShare} />

      <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-cards">
        <h3 id="fr-kanban-view-cards" className="fr-kanban-view__heading">{tr('cards')}</h3>
        <label className="fr-kanban-view__row">
          <span>{tr('density')}</span>
          {mayShare ? (
            <SegmentedControl size="sm" aria-label={tr('cardDensity')} value={card.density} options={DENSITIES} onChange={(d) => setDensity(editor, k.id, d)} />
          ) : (
            <span className="fr-kanban-view__value">{DENSITIES.find((d) => d.value === card.density)?.label}</span>
          )}
        </label>
        <p className="fr-kanban-fields__hint">{mayShare ? tr('densityChangesCardSizesFor') : tr('densityIsSetByThe')}</p>
        <label className="fr-kanban-view__row">
          <span>{tr('colourBy')}</span>
          <Select<CardColorBy>
            size="sm"
            aria-label={tr('colourCardsBy')}
            // Coloured by the field the board is now grouped by = coloured by column.
            value={card.color === groupBy ? 'group' : colorChoices.some((c) => c.value === card.color) ? card.color : 'own'}
            options={colorChoices}
            onChange={(color) => setMyCardDisplay(editor, k.id, { color })}
          />
        </label>
      </section>

      <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-fields">
        <h3 id="fr-kanban-view-fields" className="fr-kanban-view__heading">{tr('fieldsOnCards')}</h3>
        <ol className="fr-kanban-fields__list fr-kanban-view__fields" aria-label={tr('fieldsOnCards')}>
          {shown.map((f, i) => (
            <li key={f.id} className="fr-kanban-view__field">
              <Toggle size="sm" checked label={f.name} onChange={() => setShow(card.show.filter((id) => id !== f.id))} />
              <span className="fr-kanban-view__move">
                <IconButton
                  icon={ChevronUp}
                  size={32}
                  label={tr('showNameEarlier', { name: f.name })}
                  disabled={i === 0}
                  onClick={() => setShow(swap(shown.map((x) => x.id), i, i - 1))}
                />
                <IconButton
                  icon={ChevronDown}
                  size={32}
                  label={tr('showNameLater', { name: f.name })}
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
function Whose({ own, mayShare, onSave, onReset, noun = 'view' }: { own: boolean; mayShare: boolean; onSave: () => void; onReset: () => void; noun?: string }) {
  return (
    <div className={`fr-kanban-view__whose${own ? ' is-own' : ''}`} role="status">
      {own ? (
        <>
          <span>{tr('onlyYouSeeTheseChanges')}</span>
          <span className="fr-kanban-view__whose-actions">
            {mayShare && (
              <Button size="sm" variant="primary" onClick={onSave}>{tr('saveForEveryone')}</Button>
            )}
            <Button size="sm" variant="ghost" onClick={onReset}>{tr('reset')}</Button>
          </span>
        </>
      ) : (
        <span>{mayShare ? tr('everyoneSeesThisNounYour', { noun }) : tr('changesYouMakeHereAre')}</span>
      )}
    </div>
  );
}

const SCALE_CHOICES: Array<{ value: TimelineScale; label: string }> = [
  { value: 'day', label: tr('days') },
  { value: 'week', label: tr('weeks') },
  { value: 'month', label: tr('months') },
  { value: 'quarter', label: tr('quarters') },
];

/** A kanban's projection tab (a table, list, calendar or timeline): its settings, mine until saved. */
function ProjectionPanel({ editor, k, saved }: { editor: Editor; k: KanbanElement; saved: ProjectionView }) {
  const canEdit = useCanEdit();
  usePersonalView(k.id, saved.id);
  const mine = myView(editor, k, saved.id) ?? saved;
  const own = hasOwnView(editor, k);
  const mayShare = canEdit && tabsEditable(editor, k, { id: saved.id, name: saved.name, layout: saved.layout });
  return (
    <div className="fr-kanban-fields fr-kanban-view">
      <DockHeader className="fr-kanban-fields__head">
        <h2 className="fr-kanban-fields__title">{tr('view')}</h2>
        <span className="fr-kanban-fields__of">
          {richTextToPlain(k.title) || tr('kanban')} · {saved.name}
        </span>
      </DockHeader>
      <Whose own={own} mayShare={mayShare} onSave={() => saveViewForEveryone(editor, k.id)} onReset={() => resetMyView(editor, k.id)} />
      <ProjectionSettings k={k} mine={mine} scope="tab" set={(patch) => setMyView(editor, k.id, saved.id, patch)} />
    </div>
  );
}

/**
 * A linked view's settings (step 3c): the same as a tab of its layout (mine until I save them for
 * everyone), and, for editors, its name, its layout and its lock — saved changes.
 */
function LinkedViewPanel({ editor, lv }: { editor: Editor; lv: KanbanViewElement }) {
  const canEdit = useCanEdit();
  usePersonalView(lv.id, LINKED_VIEW_KEY);
  const found = useElement(lv.sourceId);
  const k = found?.type === 'kanban' ? (found as KanbanElement) : null;
  const saved = linkedView(lv);
  const mine = myLinkedView(editor, lv);
  const own = hasOwnLinkedView(editor, lv);
  const mayShare = canEdit && linkedEditable(editor, lv);
  const locker = usePeople(saved.locked ? [saved.locked.by] : []);
  const lockedBy = saved.locked ? (saved.locked.by === editor.user.id ? 'you' : (locker[saved.locked.by]?.name ?? 'someone')) : '';
  const lockedByOther = !!saved.locked && canEdit && !lv.locked && !mayShare;
  return (
    <div className="fr-kanban-fields fr-kanban-view">
      <DockHeader className="fr-kanban-fields__head">
        <h2 className="fr-kanban-fields__title">{tr('view')}</h2>
        <span className="fr-kanban-fields__of">
          {saved.name}
          {k ? tr('linkedToValue', { value: richTextToPlain(k.title) || tr('kanban') }) : ''}
        </span>
      </DockHeader>
      {!k ? (
        <div className="fr-kanban-fields__empty">
          <SlidersHorizontal size={28} strokeWidth={1.5} aria-hidden />
          <strong>{tr('itsKanbanIsnTOn')}</strong>
          <span>{canEdit ? tr('itWasDeletedUndoBrings') : tr('itWasDeletedOrIs')}</span>
        </div>
      ) : (
        <>
          <Whose own={own} mayShare={mayShare} noun={tr('linkedView2')} onSave={() => saveLinkedViewForEveryone(editor, lv.id)} onReset={() => resetMyLinkedView(editor, lv.id)} />
          {canEdit && !lv.locked && (
            <div className={`fr-kanban-view__lock${saved.locked ? ' is-locked' : ''}`}>
              {lockedByOther ? (
                <>
                  <Lock size={14} aria-hidden />
                  <span>{tr('lockedByLockedbyTheView', { lockedBy })}</span>
                </>
              ) : (
                <Toggle size="sm" checked={!!saved.locked} label={saved.locked ? tr('viewLockedByLockedby', { lockedBy }) : tr('lockThisView')} onChange={(on) => setLinkedLocked(editor, lv.id, on)} />
              )}
            </div>
          )}
          {mayShare && (
            <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-linked">
              <h3 id="fr-kanban-view-linked" className="fr-kanban-view__heading">{tr('linkedView')}</h3>
              <label className="fr-kanban-view__row">
                <span>{tr('name')}</span>
                <NameInput key={saved.name} name={saved.name} onCommit={(name) => renameLinkedView(editor, lv.id, name)} />
              </label>
              <label className="fr-kanban-view__row">
                <span>{tr('showAs')}</span>
                <Select<ProjectionLayout> size="sm" aria-label={tr('showTheCardsAs')} value={saved.layout} options={PROJECTION_LAYOUTS.map((l) => ({ value: l, label: LAYOUT_NAMES[l] }))} onChange={(l) => setLinkedLayout(editor, lv.id, l)} />
              </label>
              <p className="fr-kanban-fields__hint">{tr('changesTheViewForEveryone')}</p>
            </section>
          )}
          <ProjectionSettings k={k} mine={mine} scope="view" set={(patch) => setMyLinkedView(editor, lv.id, patch)} />
        </>
      )}
    </div>
  );
}

/** A text box that commits its name on Enter or when left (Escape puts the saved one back). */
function NameInput({ name, onCommit }: { name: string; onCommit: (name: string) => string | null }) {
  const [draft, setDraft] = useState(name);
  const [problem, setProblem] = useState<string | null>(null);
  const commit = () => {
    if (draft.trim() === name) return;
    setProblem(onCommit(draft));
  };
  return (
    <input
      className="fr-kanban-view__name"
      aria-label={tr('nameOfTheLinkedView')}
      aria-invalid={!!problem}
      title={problem ?? undefined}
      value={draft}
      maxLength={60}
      onChange={(e) => {
        setDraft(e.target.value);
        setProblem(null);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(name);
      }}
    />
  );
}

/**
 * A projection's settings (a kanban's table, list, calendar or timeline tab, or a linked view): its
 * filter and sort; a table's or a list's columns, a list's grouping, the date fields a calendar or
 * a timeline places cards by, a timeline's scale and swimlanes. All mine until I save them for
 * everyone — and since a projection moves no real card, its filter really leaves cards out and its
 * sort really orders them, for me alone.
 */
function ProjectionSettings({ k, mine, set, scope }: { k: KanbanElement; mine: ProjectionView; set: (patch: Record<string, unknown>) => void; scope: 'tab' | 'view' }) {
  const schema = collectionSchema(k);
  const noun = mine.layout === 'table' || mine.layout === 'list' ? 'rows' : 'cards';
  const NONE = '';
  const dates = dateFields(schema).map((f) => ({ value: f.id, label: f.name }));
  const groups = projectionGroupFields(schema).map((f) => ({ value: f.id, label: f.name }));
  return (
    <>
      {mine.layout === 'calendar' && (
        <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-dates">
          <h3 id="fr-kanban-view-dates" className="fr-kanban-view__heading">{tr('dates')}</h3>
          <label className="fr-kanban-view__row">
            <span>{tr('cardsSitOn')}</span>
            <Select size="sm" aria-label={tr('dateFieldTheCalendarPlaces')} value={calendarDateField(mine, schema)} options={dates} onChange={(date) => set({ date })} />
          </label>
          <p className="fr-kanban-fields__hint">{tr('draggingACardToA')}</p>
        </section>
      )}
      {mine.layout === 'timeline' && (
        <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-dates">
          <h3 id="fr-kanban-view-dates" className="fr-kanban-view__heading">{tr('bars')}</h3>
          <label className="fr-kanban-view__row">
            <span>{tr('start')}</span>
            <Select size="sm" aria-label={tr('whereBarsStart')} value={timelineFields(mine, schema).start} options={dates} onChange={(start) => set({ start })} />
          </label>
          <label className="fr-kanban-view__row">
            <span>{tr('end')}</span>
            <Select size="sm" aria-label={tr('whereBarsEnd')} value={timelineFields(mine, schema).end} options={dates} onChange={(end) => set({ end })} />
          </label>
          <label className="fr-kanban-view__row">
            <span>{tr('scale')}</span>
            <Select<TimelineScale> size="sm" aria-label={tr('timelineScale')} value={timelineFields(mine, schema).scale} options={SCALE_CHOICES} onChange={(scale) => set({ scale })} />
          </label>
          <label className="fr-kanban-view__row">
            <span>{tr('swimlanes')}</span>
            <Select size="sm" aria-label={tr('swimlanesBy')} value={timelineFields(mine, schema).lanes?.id ?? NONE} options={[{ value: NONE, label: tr('none') }, ...groups]} onChange={(id) => set({ lanesBy: id || null })} />
          </label>
          <p className="fr-kanban-fields__hint">{tr('draggingABarMovesBoth')}</p>
        </section>
      )}
      {mine.layout === 'list' && (
        <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-group">
          <h3 id="fr-kanban-view-group" className="fr-kanban-view__heading">{tr('groups')}</h3>
          <label className="fr-kanban-view__row">
            <span>{tr('groupBy')}</span>
            <Select size="sm" aria-label={tr('groupTheListBy')} value={listGroupField(k, mine, schema)?.id ?? NONE} options={[{ value: NONE, label: tr('nothing') }, ...groups]} onChange={(id) => set({ groupBy: id || null })} />
          </label>
          <p className="fr-kanban-fields__hint">{tr('altOnARowMoves')}</p>
        </section>
      )}
      <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-filter">
        <h3 id="fr-kanban-view-filter" className="fr-kanban-view__heading">{tr('filter')}</h3>
        <FilterRules k={k} schema={schema} filter={mine.filter ?? null} onChange={(filter) => set({ filter })} />
        <p className="fr-kanban-fields__hint">{tr('leavesNounOutOfThis', { noun, scope })}</p>
      </section>
      <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-sort">
        <h3 id="fr-kanban-view-sort" className="fr-kanban-view__heading">{tr('sort')}</h3>
        <SortRules schema={schema} sort={mine.sort ?? []} noun={noun} onChange={(sort) => set({ sort })} />
        <p className="fr-kanban-fields__hint">
          {mine.layout === 'timeline'
            ? tr('withoutASortBarsAre')
            : mine.layout === 'calendar'
              ? tr('ordersTheCardsWithinEach')
              : tr('withoutASortRowsFollow')}
        </p>
      </section>
      {(mine.layout === 'table' || mine.layout === 'list') && <ColumnsSection k={k} schema={schema} shown={mine.layout === 'table' ? tableColumns(mine, schema) : listColumns(k, mine, schema)} onChange={(columns) => set({ columns })} list={mine.layout === 'list'} />}
    </>
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
          {list ? tr('fieldsOnRows') : tr('columns')}
        </h3>
        <ol className="fr-kanban-fields__list fr-kanban-view__fields" aria-label={list ? tr('fieldsOnTheListS') : tr('columnsOfTheTable')}>
          {shown.map((id, i) => (
            <li key={id} className="fr-kanban-view__field">
              <Toggle size="sm" checked label={name(id)} onChange={() => setColumns(shown.filter((x) => x !== id))} />
              <span className="fr-kanban-view__move">
                <IconButton icon={ChevronUp} size={32} label={tr('moveNameLeft', { name: name(id) })} disabled={i === 0} onClick={() => setColumns(swap(shown, i, i - 1))} />
                <IconButton icon={ChevronDown} size={32} label={tr('moveNameRight', { name: name(id) })} disabled={i === shown.length - 1} onClick={() => setColumns(swap(shown, i, i + 1))} />
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
