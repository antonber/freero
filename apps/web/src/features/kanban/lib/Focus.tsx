// Focus mode (steps 3a, 3b; design §7): a kanban opened as a page of its own, arranged my way. Any
// role opens it; how it is arranged (as a table, a list, a calendar or a timeline; grouping by any
// field, density, filter, sort, which fields are columns, the date fields, scale and swimlanes) is
// mine alone and changes nothing for anyone else (lib/focusSettings.ts). It opens the way the tab
// I look at shows the cards. The table and the list are real DOM rows and cells (`role="grid"`,
// lib/Grid.tsx): the keyboard and screen-reader way to all of a kanban's data; the calendar's days
// are a grid too and the timeline's bars a list of buttons, each moved with keys. On phones it is
// the way into a kanban (tapping one opens it here): groups a swipe apart, the calendar a week as
// an agenda, the timeline's bars a tap from their dates. Editing writes the card for everyone
// (card.setValues), as on the board.
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDownUp, Columns3, Filter, RotateCcw } from 'lucide-react';
import {
  FOCUS_KEY,
  LAYOUT_NAMES,
  MY_TAB_KEY,
  PROJECTION_LAYOUTS,
  SHOWABLE_BUILTINS,
  boardView,
  collectionSchema,
  dateFields,
  queryField,
  richTextToPlain,
  tableRows,
  type KanbanElement,
  type ProjectionLayout,
  type TimelineScale,
} from '@freero/shared';
import { useCompactLayout, type PanelProps } from '@engine';
import { Button, Menu, Modal, Popover, SegmentedControl, Select, type MenuItem } from '@ui';
import { CalendarBody } from './CalendarView';
import { FOCUS_PANEL } from './constants';
import { FilterRules, SortRules } from './FilterSort';
import { Grid, type GridApi } from './Grid';
import { useKanbanCards, useMine, useTags } from './hooks';
import { focusEntries, focusGroupFields, focusSettings, resetFocus, setFocus, type FocusDensity } from './focusSettings';
import { ListBody } from './ListView';
import { useKanbanPeople } from './people';
import { LAYOUT_ICONS } from './TabStrip';
import { gridColumns } from './table';
import { myTab, myView } from './tabs';
import { TimelineBody } from './TimelineView';

import { t } from '../messages';
const ROW_H: Record<FocusDensity, number> = { compact: 36, comfortable: 56 };
const NONE = '';
/** A horizontal swipe this long (px), mostly sideways, goes to the next or previous group. */
const SWIPE_PX = 60;
const SCALES: Array<{ value: TimelineScale; label: string }> = [
  { value: 'day', label: t('days') },
  { value: 'week', label: t('weeks') },
  { value: 'month', label: t('months') },
  { value: 'quarter', label: t('quarters') },
];

export function FocusDialog({ editor, props }: PanelProps) {
  const kid = typeof props?.id === 'string' ? props.id : null;
  const close = () => editor.closePanel(FOCUS_PANEL);
  const { k, cards } = useKanbanCards(editor, kid);
  if (!k) return <Modal open onClose={close} title={t('kanbanNotFound')} description={t('itWasDeletedOrYou')} />;
  return <FocusPage editor={editor} k={k} cards={cards} onClose={close} />;
}

function FocusPage({ editor, k, cards, onClose }: { editor: PanelProps['editor']; k: KanbanElement; cards: ReturnType<typeof useKanbanCards>['cards']; onClose: () => void }) {
  // Read through the editor it is handed: focus mode works the same wherever it is opened.
  const phone = useCompactLayout();
  const canEdit = editor.can('editor');
  const raw = useMine(editor, k.id, FOCUS_KEY);
  // The tab I look at (as I see it) is where focus mode starts from when it isn't the board.
  useMine(editor, k.id, MY_TAB_KEY);
  const tab = myTab(editor, k);
  const tabMine = useMine(editor, k.id, tab.id);
  const tabView = useMemo(() => (tab.layout === 'board' ? null : myView(editor, k, tab.id)), [editor, k, tab.id, tab.layout, tabMine]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useMemo(() => focusSettings(k, raw, { phone, tab: tabView }), [k, raw, phone, tabView]);
  const schema = useMemo(() => collectionSchema(k), [k]);
  const tags = useTags(editor);
  const people = useKanbanPeople(editor);
  const personName = useMemo(() => {
    const names = new Map(people.map((p) => [p.id, p.name]));
    return (id: string) => names.get(id);
  }, [people]);
  const grouped = s.layout === 'table' || s.layout === 'list';
  const shownIds = s.columns ?? (phone || s.layout === 'list' ? (boardView(k).card?.show ?? []).slice(0, phone ? 2 : 5) : [...schema.map((f) => f.id), ...(boardView(k).card?.show ?? []).filter((id) => id.startsWith('$'))]);
  const columns = useMemo(() => gridColumns(shownIds, schema, tags), [shownIds.join('\n'), schema, tags]); // eslint-disable-line react-hooks/exhaustive-deps
  const { entries, shown, group: groupField } = useMemo(() => focusEntries(k, cards, s, { me: editor.user.id, personName }), [k, cards, s, editor, personName]);
  const rows = useMemo(() => (grouped ? [] : tableRows(k, cards, s, { me: editor.user.id })), [grouped, k, cards, s, editor]);
  const groups = useMemo(() => entries.map((e, i) => ({ e, i })).filter((x) => x.e.kind === 'group'), [entries]);
  const grid = useRef<GridApi | null>(null);
  const [group, setGroup] = useState(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [fieldsAnchor, setFieldsAnchor] = useState<HTMLElement | null>(null);

  const title = richTextToPlain(k.title) || 'Kanban';
  const groupFields = focusGroupFields(schema);
  const dates = dateFields(schema).map((f) => ({ value: f.id, label: f.name }));
  const jump = (n: number) => {
    const g = groups[Math.max(0, Math.min(groups.length - 1, n))];
    if (!g) return;
    setGroup(groups.indexOf(g));
    grid.current?.scrollTo(g.i);
  };
  const all = [...SHOWABLE_BUILTINS.map((f) => ({ id: f.id as string, name: f.name })), ...schema.map((f) => ({ id: f.id, name: f.name }))];
  const fieldItems: MenuItem[] = all.map((f) => ({
    id: f.id,
    label: f.name,
    checked: shownIds.includes(f.id),
    onSelect: () => setFocus(editor, k.id, { columns: shownIds.includes(f.id) ? shownIds.filter((x) => x !== f.id) : [...shownIds, f.id] }),
  }));
  const sortWords = s.sort.map((r) => queryField(schema, r.field)?.name).filter(Boolean).join(', ');
  const count = grouped ? shown : rows.length;
  const editable = canEdit && !k.locked;
  const empty = cards.length ? t('yourFilterLeavesOutEvery') : t('thisKanbanHasNoCards');

  return (
    <Modal
      open
      size="page"
      width={1400}
      escapeToContent
      onClose={onClose}
      className="fr-kanban-focus"
      title={title}
      description={
        <>{t('arrangedYourWayOnlyYou')}{' '}{editable ? t('changesToCardsAreSaved') : t('youCanReadEveryCard')}{' '}
          <span className="fr-kanban-focus__count">{count === cards.length ? `${cards.length} ${cards.length === 1 ? 'card' : 'cards'}` : t('countOfLengthCards', { count, length: cards.length })}</span>
        </>
      }
    >
      <div className="fr-kanban-focus__bar" role="toolbar" aria-label={t('arrangeThisKanbanForYou')}>
        <SegmentedControl<ProjectionLayout>
          size="sm"
          aria-label={t('showTheCardsAs')}
          value={s.layout}
          options={PROJECTION_LAYOUTS.map((l) => ({ value: l, label: phone ? undefined : LAYOUT_NAMES[l], icon: LAYOUT_ICONS[l], title: LAYOUT_NAMES[l] }))}
          onChange={(layout) => setFocus(editor, k.id, { layout })}
        />
        {grouped && (
          <label className="fr-kanban-focus__ctl">
            <span>{t('groupBy')}</span>
            <Select
              size="sm"
              aria-label={t('groupCardsBy')}
              value={s.groupBy ?? NONE}
              options={[{ value: NONE, label: t('nothing') }, ...groupFields.map((f) => ({ value: f.id, label: f.name }))]}
              onChange={(v) => setFocus(editor, k.id, { groupBy: v || null })}
            />
          </label>
        )}
        {grouped && (
          <SegmentedControl
            size="sm"
            aria-label={t('rowDensity')}
            value={s.density}
            options={[
              { value: 'compact', label: t('compact') },
              { value: 'comfortable', label: t('comfortable') },
            ]}
            onChange={(density) => setFocus(editor, k.id, { density })}
          />
        )}
        {s.layout === 'calendar' && (
          <label className="fr-kanban-focus__ctl">
            <span>{t('by')}</span>
            <Select size="sm" aria-label={t('dateFieldTheCalendarPlaces')} value={s.date} options={dates} onChange={(date) => setFocus(editor, k.id, { date })} />
          </label>
        )}
        {s.layout === 'timeline' && (
          <>
            <label className="fr-kanban-focus__ctl">
              <span>{t('from')}</span>
              <Select size="sm" aria-label={t('whereBarsStart')} value={s.start} options={dates} onChange={(start) => setFocus(editor, k.id, { start })} />
            </label>
            <label className="fr-kanban-focus__ctl">
              <span>{t('to')}</span>
              <Select size="sm" aria-label={t('whereBarsEnd')} value={s.end} options={dates} onChange={(end) => setFocus(editor, k.id, { end })} />
            </label>
            <Select<TimelineScale> size="sm" aria-label={t('timelineScale')} value={s.scale} options={SCALES} onChange={(scale) => setFocus(editor, k.id, { scale })} />
            <label className="fr-kanban-focus__ctl">
              <span>{t('lanes')}</span>
              <Select
                size="sm"
                aria-label={t('swimlanesBy')}
                value={s.lanesBy ?? NONE}
                options={[{ value: NONE, label: t('none') }, ...groupFields.map((f) => ({ value: f.id, label: f.name }))]}
                onChange={(v) => setFocus(editor, k.id, { lanesBy: v || null })}
              />
            </label>
          </>
        )}
        <Button size="sm" variant={s.filter ? 'secondary' : 'ghost'} icon={Filter} aria-expanded={!!filterAnchor} onClick={(e) => setFilterAnchor(filterAnchor ? null : e.currentTarget)}>
          {s.filter ? t('filterLength', { length: s.filter.rules.length }) : t('filter')}
        </Button>
        <Button size="sm" variant={s.sort.length ? 'secondary' : 'ghost'} icon={ArrowDownUp} aria-expanded={!!sortAnchor} onClick={(e) => setSortAnchor(sortAnchor ? null : e.currentTarget)}>
          {s.sort.length ? t('sortedBySortwords', { sortWords }) : t('sort')}
        </Button>
        {grouped && (
          <Button size="sm" variant="ghost" icon={Columns3} aria-haspopup="menu" aria-expanded={!!fieldsAnchor} onClick={(e) => setFieldsAnchor(fieldsAnchor ? null : e.currentTarget)}>{t('fields')}</Button>
        )}
        {raw && (
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => resetFocus(editor, k.id)}>
            {tab.layout === 'board' ? t('asOnTheBoard') : t('asInName', { name: tab.name })}
          </Button>
        )}
      </div>
      {phone && grouped && groups.length > 1 && (
        <div className="fr-kanban-focus__groups" role="tablist" aria-label={t('groups')}>
          {groups.map((g, n) =>
            g.e.kind === 'group' ? (
              <button key={g.e.key} type="button" role="tab" aria-selected={n === group} className={`fr-kanban-focus__group${n === group ? ' is-on' : ''}`} style={{ ['--opt' as string]: g.e.color ?? 'var(--fr-ink-3)' }} onClick={() => jump(n)}>
                <span className="fr-kanban-grid__dot" aria-hidden />
                {g.e.title}
                <span className="fr-kanban-focus__group-count">{g.e.count}</span>
              </button>
            ) : null,
          )}
        </div>
      )}
      <div
        className={`fr-kanban-focus__grid is-${s.layout}`}
        onPointerDown={(e: ReactPointerEvent) => {
          if (phone && grouped) swipe.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e: ReactPointerEvent) => {
          const from = swipe.current;
          swipe.current = null;
          if (!from || groups.length < 2) return;
          const dx = e.clientX - from.x;
          if (Math.abs(dx) >= SWIPE_PX && Math.abs(e.clientY - from.y) < SWIPE_PX / 1.5) jump(group + (dx < 0 ? 1 : -1));
        }}
      >
        {s.layout === 'table' && (
          <Grid
            editor={editor}
            k={k}
            schema={schema}
            entries={entries}
            columns={columns}
            canEdit={editable}
            rowH={ROW_H[s.density]}
            descriptions={s.density === 'comfortable'}
            label={t('titleCards', { title })}
            interactive
            api={grid}
            empty={empty}
          />
        )}
        {s.layout === 'list' && (
          <ListBody
            editor={editor}
            k={k}
            entries={entries}
            group={groupField}
            columns={shownIds}
            canEdit={editable}
            rowH={ROW_H[s.density] + 4}
            descriptions={s.density === 'comfortable'}
            label={t('titleCardsAsAList', { title })}
            titleWidth={phone ? 230 : undefined}
            interactive
            api={grid}
            empty={empty}
          />
        )}
        {s.layout === 'calendar' && <CalendarBody editor={editor} k={k} rows={rows} dateRef={s.date} canEdit={editable} interactive label={t('titleCardsByDate', { title })} compact={phone} />}
        {s.layout === 'timeline' && (
          <TimelineBody
            editor={editor}
            k={k}
            rows={rows}
            sorted={s.sort.length > 0}
            startRef={s.start}
            endRef={s.end}
            scale={s.scale}
            lanes={groupFields.find((f) => f.id === s.lanesBy) ?? null}
            canEdit={editable}
            interactive
            label={t('titleCardsOnATimeline', { title })}
            compact={phone}
          />
        )}
      </div>
      <Popover open={!!filterAnchor} onClose={() => setFilterAnchor(null)} anchor={filterAnchor} side="bottom" align="start" width={420} aria-label={t('filterForYou')} escapeToContent>
        <div className="fr-kanban-focus__pop">
          <FilterRules k={k} schema={schema} filter={s.filter} onChange={(filter) => setFocus(editor, k.id, { filter })} />
          <p className="fr-kanban-fields__hint">{t('leavesCardsOutOfThis')}</p>
        </div>
      </Popover>
      <Popover open={!!sortAnchor} onClose={() => setSortAnchor(null)} anchor={sortAnchor} side="bottom" align="start" width={420} aria-label={t('sortForYou')} escapeToContent>
        <div className="fr-kanban-focus__pop">
          <SortRules schema={schema} sort={s.sort} noun={grouped ? 'rows' : 'cards'} onChange={(sort) => setFocus(editor, k.id, { sort })} />
          <p className="fr-kanban-fields__hint">{t('ordersThe')}{' '}{grouped ? 'rows' : 'cards'}{' '}{t('hereForYouOnlyThe')}</p>
        </div>
      </Popover>
      <Menu open={!!fieldsAnchor} onClose={() => setFieldsAnchor(null)} anchor={fieldsAnchor} items={fieldItems} aria-label={t('fieldsShown')} />
    </Modal>
  );
}
