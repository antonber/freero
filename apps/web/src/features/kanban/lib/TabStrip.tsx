// The kanban header's tabs (steps 3a, 3b): Board and the kanban's tables, lists, calendars and
// timelines. Clicking one looks at it, for me only (the board and everyone else's view don't change)
// until I save my view for everyone. The tab I look at has a menu: rename it, delete it (any but the
// board), open the kanban in focus mode, place it beside the kanban as a linked view (step 3c). "+ View"
// adds a tab of a layout for everyone (editors).
import { useRef, useState } from 'react';
import { CalendarDays, GanttChart, Kanban as BoardIcon, Link2, List, Maximize2, MoreHorizontal, Pencil, Plus, Table2, Trash2, type LucideIcon } from 'lucide-react';
import { LAYOUT_NAMES, PROJECTION_LAYOUTS, savedTabId, viewTabs, type KanbanElement, type ProjectionLayout, type ViewLayout, type ViewTab } from '@freero/shared';
import type { Editor } from '@engine';
import { Menu, type MenuItem } from '@ui';
import { FOCUS_PANEL } from './constants';
import { addTab, deleteTab, renameTab, switchTab, tabsEditable } from './tabs';
import { addLinkedView } from './linked';

/** Each layout's icon (its tabs, "+ View", focus mode). */
export const LAYOUT_ICONS: Record<ViewLayout, LucideIcon> = { board: BoardIcon, table: Table2, list: List, calendar: CalendarDays, timeline: GanttChart };
const LAYOUT_HINTS: Record<ProjectionLayout, string> = {
  table: 'Every card as a row, a column per field',
  list: 'A line per card, grouped',
  calendar: 'Cards on the days of their dates',
  timeline: 'Cards as bars from start to due date',
};

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

function RenameBox({ editor, k, tab, onDone }: { editor: Editor; k: KanbanElement; tab: ViewTab; onDone: () => void }) {
  const [draft, setDraft] = useState(tab.name);
  const [problem, setProblem] = useState<string | null>(null);
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    const p = renameTab(editor, k.id, tab.id, draft);
    if (p) return setProblem(p);
    done.current = true;
    onDone();
  };
  return (
    <input
      className={`fr-kanban__tab-input${problem ? ' is-invalid' : ''}`}
      data-fr-interactive=""
      aria-label="Tab name"
      aria-invalid={!!problem}
      title={problem ?? undefined}
      autoFocus
      value={draft}
      onPointerDown={stop}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        setProblem(null);
      }}
      onBlur={() => {
        // Leaving the box keeps a name that can be one; a taken or empty one is dropped.
        if (done.current) return;
        renameTab(editor, k.id, tab.id, draft);
        done.current = true;
        onDone();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          done.current = true;
          onDone();
        }
      }}
    />
  );
}

export function TabStrip({ editor, k, shownId, selected, canEdit }: { editor: Editor; k: KanbanElement; shownId: string; selected: boolean; canEdit: boolean }) {
  const tabs = viewTabs(k);
  const saved = savedTabId(k);
  const [menu, setMenu] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const mayAdd = selected && canEdit && tabsEditable(editor, k);
  if (tabs.length < 2 && !mayAdd) return null;
  // A linked view beside the kanban (step 3c): this tab as I see it, or — from the board — a layout.
  const linked = (tab: ViewTab): MenuItem[] =>
    !canEdit || !editor.mayAdd('kanbanview')
      ? []
      : tab.layout === 'board'
        ? [
            {
              id: 'linked',
              label: 'Add linked view',
              icon: Link2,
              onSelect: () => undefined,
              submenu: PROJECTION_LAYOUTS.map((layout) => ({ id: `linked-${layout}`, label: LAYOUT_NAMES[layout], icon: LAYOUT_ICONS[layout], onSelect: () => void addLinkedView(editor, k.id, layout) })),
            },
          ]
        : [{ id: 'linked', label: 'Add as linked view', icon: Link2, onSelect: () => void addLinkedView(editor, k.id, tab.layout as ProjectionLayout, { from: tab.id }) }];
  const items = (tab: ViewTab): MenuItem[] => [
    ...(canEdit && tabsEditable(editor, k, tab) ? [{ id: 'rename', label: 'Rename tab', icon: Pencil, onSelect: () => setRenaming(tab.id) }] : []),
    { id: 'focus', label: 'Open in focus mode', icon: Maximize2, onSelect: () => editor.openPanel(FOCUS_PANEL, { id: k.id }) },
    ...linked(tab),
    ...(tab.layout !== 'board' && canEdit && tabsEditable(editor, k, tab)
      ? [{ divider: true as const }, { id: 'delete', label: 'Delete tab', icon: Trash2, danger: true, onSelect: () => deleteTab(editor, k.id, tab.id) }]
      : []),
  ];
  return (
    <div className="fr-kanban__tabs" role="tablist" aria-label="Views of this kanban">
      {tabs.map((tab) => {
        const on = tab.id === shownId;
        const Icon = LAYOUT_ICONS[tab.layout];
        if (renaming === tab.id) return <RenameBox key={tab.id} editor={editor} k={k} tab={tab} onDone={() => setRenaming(null)} />;
        return (
          <span key={tab.id} className={`fr-kanban__tab${on ? ' is-on' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={on}
              className="fr-kanban__tab-btn"
              data-fr-interactive=""
              title={tab.id === saved ? `${tab.name} (everyone starts here)` : tab.name}
              onPointerDown={stop}
              onClick={() => switchTab(editor, k.id, tab.id)}
              onDoubleClick={() => canEdit && tabsEditable(editor, k, tab) && setRenaming(tab.id)}
            >
              <Icon size={13} aria-hidden />
              <span className="fr-kanban__tab-name">{tab.name}</span>
            </button>
            {on && selected && (
              <button
                type="button"
                className="fr-kanban__tab-menu"
                data-fr-interactive=""
                aria-label={`Tab options: ${tab.name}`}
                aria-haspopup="menu"
                aria-expanded={menu?.id === tab.id}
                onPointerDown={stop}
                onClick={(e) => setMenu(menu?.id === tab.id ? null : { id: tab.id, el: e.currentTarget })}
              >
                <MoreHorizontal size={14} aria-hidden />
              </button>
            )}
          </span>
        );
      })}
      {mayAdd && (
        <button
          type="button"
          className="fr-kanban__tab-add"
          data-fr-interactive=""
          title="Add a view of these cards: a table, list, calendar or timeline (for everyone)"
          aria-haspopup="menu"
          aria-expanded={!!adding}
          onPointerDown={stop}
          onClick={(e) => setAdding(adding ? null : e.currentTarget)}
        >
          <Plus size={13} aria-hidden />
          View
        </button>
      )}
      {adding && (
        <Menu
          open
          anchor={adding}
          aria-label="Add a view"
          onClose={() => setAdding(null)}
          items={PROJECTION_LAYOUTS.map((layout) => ({
            id: layout,
            label: (
              <span className="fr-kanban__add-view">
                <strong>{LAYOUT_NAMES[layout]}</strong>
                <span>{LAYOUT_HINTS[layout]}</span>
              </span>
            ),
            icon: LAYOUT_ICONS[layout],
            onSelect: () => void addTab(editor, k.id, layout),
          }))}
        />
      )}
      {menu && (
        <Menu open anchor={menu.el} items={items(tabs.find((t) => t.id === menu.id) ?? tabs[0])} aria-label="Tab options" onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
