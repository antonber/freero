// A kanban's view tabs (steps 3a, 3b; the model is @freero/shared tabs.ts): the board, and tables,
// lists, calendars and timelines of the same cards. Which tab I look at is mine (personal view
// state, any role) until I "Save for everyone" (views.ts `saveViewForEveryone`); while it is not
// the board, the kanban folds its cards away for me alone and draws them its own way instead
// (`hidesMember`). Adding, renaming and deleting tabs changes the saved tabs everyone sees:
// editors, on an unlocked kanban, and nobody but whoever locked a tab (and the board's owners)
// touches a locked one.
import { nanoid } from 'nanoid';
import {
  LAYOUT_NAMES,
  MY_TAB_KEY,
  boardView,
  cleanProjectionOverride,
  freeTabName,
  projectionOverrideBetween,
  projectionView,
  savedTabId,
  shownTabId,
  tabNameProblem,
  viewLockedFor,
  viewTabs,
  withProjectionOverride,
  withProjectionTab,
  withTabRenamed,
  withoutTab,
  type KanbanElement,
  type ProjectionLayout,
  type ProjectionOverride,
  type ProjectionView,
  type ViewTab,
} from '@freero/shared';
import type { Editor } from '@engine';

type Reader = Pick<Editor, 'getPersonalView'>;

const kanbanOf = (editor: Pick<Editor, 'getElement'>, id: string): KanbanElement | null => {
  const k = editor.getElement<KanbanElement>(id);
  return k && k.type === 'kanban' ? k : null;
};

/** The tab I look at on kanban `k` (my own choice while it is still a tab, else the saved one). */
export const myTabId = (editor: Reader, k: KanbanElement): string => shownTabId(k, editor.getPersonalView(k.id, MY_TAB_KEY));

export function myTab(editor: Reader, k: KanbanElement): ViewTab {
  const id = myTabId(editor, k);
  return viewTabs(k).find((t) => t.id === id)!;
}

/** True while I look at a tab other than the board (a table, list, calendar, timeline): its cards are folded away for me, drawn by the tab. */
export const showsProjection = (editor: Reader, k: KanbanElement): boolean => myTab(editor, k).layout !== 'board';

/** Looks at tab `tabId` of kanban `kid`, for me only (any role). Back on the saved tab I follow it again. */
export function switchTab(editor: Editor, kid: string, tabId: string): boolean {
  const k = kanbanOf(editor, kid);
  if (!k || !viewTabs(k).some((t) => t.id === tabId)) return false;
  editor.setPersonalView(k.id, MY_TAB_KEY, tabId === savedTabId(k) ? null : { tab: tabId });
  return true;
}

const who = (editor: Pick<Editor, 'can' | 'user'>) => ({ id: editor.user.id, role: editor.can('owner') ? ('owner' as const) : ('editor' as const) });

/** Whether I may change kanban `k`'s saved tabs (add one; rename or delete tab `tab`, when given). */
export function tabsEditable(editor: Pick<Editor, 'can' | 'user'>, k: KanbanElement, tab?: ViewTab): boolean {
  if (!editor.can('editor') || k.locked) return false;
  if (!tab) return true;
  const saved = tab.layout === 'board' ? boardView(k) : projectionView(k, tab.id);
  return !!saved && !viewLockedFor(saved, who(editor));
}

/** Adds a `layout` tab (saved for everyone; one undo step) and shows it to me. Returns its id. */
export function addTab(editor: Editor, kid: string, layout: ProjectionLayout, name?: string): string | null {
  const k = kanbanOf(editor, kid);
  if (!k || !tabsEditable(editor, k)) return null;
  const tab = { id: `t${nanoid(8)}`, name: name?.trim() && !tabNameProblem(k, name) ? name.trim() : freeTabName(k, LAYOUT_NAMES[layout]), layout } as ProjectionView;
  const patch = withProjectionTab(k, tab);
  if (!patch) return null;
  editor.update<KanbanElement>(k.id, patch);
  switchTab(editor, k.id, tab.id);
  return tab.id;
}

/** Adds a table tab (3a's command). */
export const addTableTab = (editor: Editor, kid: string, name?: string) => addTab(editor, kid, 'table', name);

/** Renames tab `id` for everyone; returns why it can't be (a taken or empty name), or null. */
export function renameTab(editor: Editor, kid: string, id: string, name: string): string | null {
  const k = kanbanOf(editor, kid);
  const tab = k && viewTabs(k).find((t) => t.id === id);
  if (!k || !tab || !tabsEditable(editor, k, tab)) return 'You can’t rename this tab';
  const problem = tabNameProblem(k, name, id);
  if (problem) return problem;
  if (name.trim() === tab.name) return null;
  const patch = withTabRenamed(k, id, name);
  if (patch) editor.update<KanbanElement>(k.id, patch);
  return null;
}

/** Deletes tab `id` for everyone (the board tab stays); whoever looked at it is back on the saved tab. */
export function deleteTab(editor: Editor, kid: string, id: string): boolean {
  const k = kanbanOf(editor, kid);
  const tab = k && viewTabs(k).find((t) => t.id === id);
  if (!k || !tab || tab.layout === 'board' || !tabsEditable(editor, k, tab)) return false;
  const patch = withoutTab(k, id);
  if (!patch) return false;
  editor.update<KanbanElement>(k.id, patch);
  editor.setPersonalView(k.id, id, null);
  return true;
}

// ------------------------------------------------------------------ my own changes to a tab

/** Tab `id` as I see it (my changes on top of the saved tab); null when there is no such tab or it is the board. */
export function myView(editor: Reader, k: KanbanElement, id: string): ProjectionView | null {
  const saved = projectionView(k, id);
  return saved ? withProjectionOverride(saved, editor.getPersonalView(k.id, id)) : null;
}

/**
 * Changes tab `id`'s settings (a table's columns, a list's grouping, a calendar's date field, a
 * timeline's dates, scale and swimlanes; any tab's filter and sort) for me only (any role), until
 * I save it for everyone. Settings its layout doesn't have are ignored.
 */
export function setMyView(editor: Editor, kid: string, id: string, patch: ProjectionOverride | Record<string, unknown>): void {
  const k = kanbanOf(editor, kid);
  const saved = k && projectionView(k, id);
  if (!k || !saved) return;
  const mine = myView(editor, k, id)!;
  const clean = cleanProjectionOverride(saved.layout, patch) ?? {};
  const next = cleanProjectionOverride(saved.layout, projectionOverrideBetween(saved, { ...mine, ...clean } as ProjectionView));
  editor.setPersonalView(k.id, id, next as Record<string, unknown> | null);
}
