// Focus mode (step 3a, design §7): a kanban opened as a page of its own, arranged my way. Any role
// opens it; how it is arranged (grouping by any field, density, filter, sort, which fields are
// columns) is mine alone and changes nothing for anyone else (lib/focus.ts). The cards are real
// DOM rows and cells (`role="grid"`, lib/Grid.tsx): the keyboard and screen-reader way to all of a
// kanban's data, and on phones the way into a kanban (tapping one opens it here), with its groups
// a swipe apart. Editing a cell writes the card for everyone (card.setValues), as on the board.
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDownUp, Columns3, Filter, RotateCcw } from 'lucide-react';
import { FOCUS_KEY, SHOWABLE_BUILTINS, boardView, collectionSchema, queryField, richTextToPlain, type KanbanElement } from '@freero/shared';
import { useCompactLayout, type PanelProps } from '@engine';
import { Button, Menu, Modal, Popover, SegmentedControl, Select, type MenuItem } from '@ui';
import { FOCUS_PANEL } from './constants';
import { FilterRules, SortRules } from './FilterSort';
import { Grid, type GridApi } from './Grid';
import { useKanbanCards, useMine, useTags } from './hooks';
import { focusEntries, focusGroupFields, focusSettings, resetFocus, setFocus, type FocusDensity } from './focusSettings';
import { useKanbanPeople } from './people';
import { gridColumns } from './table';

const ROW_H: Record<FocusDensity, number> = { compact: 36, comfortable: 56 };
const NONE = '';
/** A horizontal swipe this long (px), mostly sideways, goes to the next or previous group. */
const SWIPE_PX = 60;

export function FocusDialog({ editor, props }: PanelProps) {
  const kid = typeof props?.id === 'string' ? props.id : null;
  const close = () => editor.closePanel(FOCUS_PANEL);
  const { k, cards } = useKanbanCards(editor, kid);
  if (!k) return <Modal open onClose={close} title="Kanban not found" description="It was deleted, or you can no longer see it." />;
  return <FocusPage editor={editor} k={k} cards={cards} onClose={close} />;
}

function FocusPage({ editor, k, cards, onClose }: { editor: PanelProps['editor']; k: KanbanElement; cards: ReturnType<typeof useKanbanCards>['cards']; onClose: () => void }) {
  // Read through the editor it is handed: focus mode works the same wherever it is opened.
  const phone = useCompactLayout();
  const canEdit = editor.can('editor');
  const raw = useMine(editor, k.id, FOCUS_KEY);
  const s = useMemo(() => focusSettings(k, raw, { phone }), [k, raw, phone]);
  const schema = useMemo(() => collectionSchema(k), [k]);
  const tags = useTags(editor);
  const people = useKanbanPeople(editor);
  const personName = useMemo(() => {
    const names = new Map(people.map((p) => [p.id, p.name]));
    return (id: string) => names.get(id);
  }, [people]);
  const shownIds = s.columns ?? (phone ? (boardView(k).card?.show ?? []).slice(0, 2) : [...schema.map((f) => f.id), ...(boardView(k).card?.show ?? []).filter((id) => id.startsWith('$'))]);
  const columns = useMemo(() => gridColumns(shownIds, schema, tags), [shownIds.join('\n'), schema, tags]); // eslint-disable-line react-hooks/exhaustive-deps
  const { entries, shown } = useMemo(() => focusEntries(k, cards, s, { me: editor.user.id, personName }), [k, cards, s, editor, personName]);
  const groups = useMemo(() => entries.map((e, i) => ({ e, i })).filter((x) => x.e.kind === 'group'), [entries]);
  const grid = useRef<GridApi | null>(null);
  const [group, setGroup] = useState(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [fieldsAnchor, setFieldsAnchor] = useState<HTMLElement | null>(null);

  const title = richTextToPlain(k.title) || 'Kanban';
  const groupFields = focusGroupFields(schema);
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
        <>
          Arranged your way: only you see how. {canEdit && !k.locked ? 'Changes to cards are saved for everyone.' : 'You can read every card here.'}{' '}
          <span className="fr-kanban-focus__count">
            {shown === cards.length ? `${cards.length} ${cards.length === 1 ? 'card' : 'cards'}` : `${shown} of ${cards.length} cards`}
          </span>
        </>
      }
    >
      <div className="fr-kanban-focus__bar" role="toolbar" aria-label="Arrange this kanban for you">
        <label className="fr-kanban-focus__ctl">
          <span>Group by</span>
          <Select
            size="sm"
            aria-label="Group cards by"
            value={s.groupBy ?? NONE}
            options={[{ value: NONE, label: 'Nothing' }, ...groupFields.map((f) => ({ value: f.id, label: f.name }))]}
            onChange={(v) => setFocus(editor, k.id, { groupBy: v || null })}
          />
        </label>
        <SegmentedControl
          size="sm"
          aria-label="Row density"
          value={s.density}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'comfortable', label: 'Comfortable' },
          ]}
          onChange={(density) => setFocus(editor, k.id, { density })}
        />
        <Button size="sm" variant={s.filter ? 'secondary' : 'ghost'} icon={Filter} aria-expanded={!!filterAnchor} onClick={(e) => setFilterAnchor(filterAnchor ? null : e.currentTarget)}>
          {s.filter ? `Filter (${s.filter.rules.length})` : 'Filter'}
        </Button>
        <Button size="sm" variant={s.sort.length ? 'secondary' : 'ghost'} icon={ArrowDownUp} aria-expanded={!!sortAnchor} onClick={(e) => setSortAnchor(sortAnchor ? null : e.currentTarget)}>
          {s.sort.length ? `Sorted by ${sortWords}` : 'Sort'}
        </Button>
        <Button size="sm" variant="ghost" icon={Columns3} aria-haspopup="menu" aria-expanded={!!fieldsAnchor} onClick={(e) => setFieldsAnchor(fieldsAnchor ? null : e.currentTarget)}>
          Fields
        </Button>
        {raw && (
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => resetFocus(editor, k.id)}>
            As on the board
          </Button>
        )}
      </div>
      {phone && groups.length > 1 && (
        <div className="fr-kanban-focus__groups" role="tablist" aria-label="Groups">
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
        className="fr-kanban-focus__grid"
        onPointerDown={(e: ReactPointerEvent) => {
          if (phone) swipe.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e: ReactPointerEvent) => {
          const from = swipe.current;
          swipe.current = null;
          if (!from || groups.length < 2) return;
          const dx = e.clientX - from.x;
          if (Math.abs(dx) >= SWIPE_PX && Math.abs(e.clientY - from.y) < SWIPE_PX / 1.5) jump(group + (dx < 0 ? 1 : -1));
        }}
      >
        <Grid
          editor={editor}
          k={k}
          schema={schema}
          entries={entries}
          columns={columns}
          canEdit={canEdit && !k.locked}
          rowH={ROW_H[s.density]}
          descriptions={s.density === 'comfortable'}
          label={`${title}: cards`}
          interactive
          api={grid}
          empty={cards.length ? 'Your filter leaves out every card.' : 'This kanban has no cards yet.'}
        />
      </div>
      <Popover open={!!filterAnchor} onClose={() => setFilterAnchor(null)} anchor={filterAnchor} side="bottom" align="start" width={420} aria-label="Filter for you" escapeToContent>
        <div className="fr-kanban-focus__pop">
          <FilterRules k={k} schema={schema} filter={s.filter} onChange={(filter) => setFocus(editor, k.id, { filter })} />
          <p className="fr-kanban-fields__hint">Leaves cards out of this page, for you only. The board doesn’t change.</p>
        </div>
      </Popover>
      <Popover open={!!sortAnchor} onClose={() => setSortAnchor(null)} anchor={sortAnchor} side="bottom" align="start" width={420} aria-label="Sort for you" escapeToContent>
        <div className="fr-kanban-focus__pop">
          <SortRules schema={schema} sort={s.sort} noun="rows" onChange={(sort) => setFocus(editor, k.id, { sort })} />
          <p className="fr-kanban-fields__hint">Orders the rows here, for you only. The cards stay where they are on the board.</p>
        </div>
      </Popover>
      <Menu open={!!fieldsAnchor} onClose={() => setFieldsAnchor(null)} anchor={fieldsAnchor} items={fieldItems} aria-label="Fields shown" />
    </Modal>
  );
}
