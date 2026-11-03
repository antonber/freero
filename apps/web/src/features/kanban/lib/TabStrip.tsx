// The kanban header's tabs (step 3a): Board and the kanban's tables. Clicking one looks at it, for
// me only (the board and everyone else's view don't change) until I save my view for everyone. The
// tab I look at has a menu: rename it, delete it (a table), open the kanban in focus mode. "+ Table"
// adds a table tab for everyone (editors).
import { useRef, useState } from 'react';
import { Kanban as BoardIcon, Maximize2, MoreHorizontal, Pencil, Plus, Table2, Trash2 } from 'lucide-react';
import { savedTabId, viewTabs, type KanbanElement, type ViewTab } from '@freero/shared';
import type { Editor } from '@engine';
import { Menu, type MenuItem } from '@ui';
import { FOCUS_PANEL } from './constants';
import { addTableTab, deleteTab, renameTab, switchTab, tabsEditable } from './tabs';

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
  const mayAdd = selected && canEdit && tabsEditable(editor, k);
  if (tabs.length < 2 && !mayAdd) return null;
  const items = (tab: ViewTab): MenuItem[] => [
    ...(canEdit && tabsEditable(editor, k, tab) ? [{ id: 'rename', label: 'Rename tab', icon: Pencil, onSelect: () => setRenaming(tab.id) }] : []),
    { id: 'focus', label: 'Open in focus mode', icon: Maximize2, onSelect: () => editor.openPanel(FOCUS_PANEL, { id: k.id }) },
    ...(tab.layout === 'table' && canEdit && tabsEditable(editor, k, tab)
      ? [{ divider: true as const }, { id: 'delete', label: 'Delete tab', icon: Trash2, danger: true, onSelect: () => deleteTab(editor, k.id, tab.id) }]
      : []),
  ];
  return (
    <div className="fr-kanban__tabs" role="tablist" aria-label="Views of this kanban">
      {tabs.map((tab) => {
        const on = tab.id === shownId;
        const Icon = tab.layout === 'table' ? Table2 : BoardIcon;
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
        <button type="button" className="fr-kanban__tab-add" data-fr-interactive="" title="Add a table of these cards (for everyone)" onPointerDown={stop} onClick={() => addTableTab(editor, k.id)}>
          <Plus size={13} aria-hidden />
          Table
        </button>
      )}
      {menu && (
        <Menu open anchor={menu.el} items={items(tabs.find((t) => t.id === menu.id) ?? tabs[0])} aria-label="Tab options" onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
