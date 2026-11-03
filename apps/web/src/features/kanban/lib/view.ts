// The kanban's board view (docs/design/kanban-fields-and-views.md, step 2b): what its cards show
// and how they are coloured. Two layers: the SAVED view on the element (`views`, written by
// editors, what everyone starts from) and this person's own changes on top of it (a personal
// override, Editor.setPersonalView: any role, never in the doc). Changing which fields show or
// what colours cards changes only my view until I "Save for everyone"; density changes the cards'
// size on the shared board, so it is saved directly (editors).
//
// Filter and sort (step 2d). The SAVED filter hides the cards it leaves out from everyone: they
// stay in their column, folded away below the board, so the others close up — every client lays
// the board out the same. My own filter (any role; mine until an editor saves it) can't do that:
// hiding a card for me alone would leave a hole in a stack everyone shares, or move cards under
// other people's cursors. So it FADES the cards it leaves out, for me only, and the board itself
// doesn't change. Sorting moves the real cards, so it is saved directly (editors); while a sort
// lasts, the view keeps the manual order, and clearing the sort puts every card back.
//
// A locked view (editors lock it) is changed as saved only by whoever locked it and the board's
// owners; everyone keeps their own view settings.
import {
  boardView,
  cardAccent,
  cardChips,
  cardPasses,
  cleanFilter,
  cleanSort,
  collectionSchema,
  manualOrderOf,
  overrideBetween,
  sameFilter,
  savedViews,
  viewLockedFor,
  withOverride,
  type BoardElement,
  type CardColorBy,
  type CardDensity,
  type CardElement,
  type KanbanElement,
  type SortRule,
  type ViewConfig,
  type ViewFilter,
  MY_TAB_KEY,
  savedTabId,
  projectionOverrideBetween,
  projectionView,
  withSavedTab,
  withProjectionSaved,
} from '@freero/shared';
import type { ChildPresentation, Editor } from '@engine';
import { myTab, myTabId, myView } from './tabs';

/** The kanban's board view, with this person's own changes when `personal`. */
export function viewOf(editor: Pick<Editor, 'getPersonalView'>, k: KanbanElement, personal: boolean): ViewConfig {
  const saved = boardView(k);
  return personal ? withOverride(saved, editor.getPersonalView(k.id, saved.id)) : saved;
}

/** True when this person sees the board view differently from what is saved. */
export function hasOwnView(editor: Pick<Editor, 'getPersonalView'>, k: KanbanElement): boolean {
  const tab = myTab(editor, k);
  if (tab.id !== savedTabId(k)) return true;
  if (tab.layout === 'board') return !!overrideBetween(boardView(k), viewOf(editor, k, true));
  const saved = projectionView(k, tab.id);
  return !!saved && !!projectionOverrideBetween(saved, myView(editor, k, tab.id)!);
}

/**
 * How a card on kanban `k` is shown: its accent (derived, never written), chips and density; faded
 * when my own filter (not the saved one) leaves it out.
 */
export function presentCard(k: KanbanElement, child: BoardElement, editor: Pick<Editor, 'getPersonalView' | 'user'>, personal: boolean): ChildPresentation | null {
  if (child.type !== 'card' || child.frameId !== k.id) return null;
  const view = viewOf(editor, k, personal);
  const schema = collectionSchema(k);
  const mine = personal && !sameFilter(view.filter, boardView(k).filter);
  const muted = mine && !cardPasses(k, child as CardElement, view.filter, schema, { me: editor.user.id });
  return { accent: cardAccent(k, child, view, schema), chips: cardChips(k, child, view, schema), density: view.card?.density ?? 'comfortable', ...(muted ? { muted: true } : {}) };
}

/**
 * Whether this person may change kanban `k`'s view for everyone: an editor, the kanban unlocked,
 * the view not locked by someone else.
 */
export function viewEditable(editor: Pick<Editor, 'can' | 'user'>, k: KanbanElement): boolean {
  return editor.can('editor') && !k.locked && !viewLockedFor(boardView(k), { id: editor.user.id, role: editor.can('owner') ? 'owner' : 'editor' });
}

/** What changes the cards' size (re-normalised when it changes). */
export const presentationKey = (k: KanbanElement) => boardView(k).card?.density ?? 'comfortable';

function editable(editor: Editor, id: string): KanbanElement | null {
  const k = editor.getElement<KanbanElement>(id);
  return k && k.type === 'kanban' ? k : null;
}

/**
 * Changes which fields cards show (in order) or what colours them, for me only: kept as my
 * override of the saved view (cleared when it equals the saved view again). Any role.
 */
export function setMyCardDisplay(editor: Editor, kid: string, patch: { show?: string[]; color?: CardColorBy }) {
  const k = editable(editor, kid);
  if (!k) return;
  const saved = boardView(k);
  const mine = viewOf(editor, k, true);
  const next: ViewConfig = { ...mine, card: { ...mine.card!, ...patch } };
  editor.setPersonalView(k.id, saved.id, overrideBetween(saved, next) as Record<string, unknown> | null);
}

/** Back to the saved view (drops my own changes). */
export function resetMyView(editor: Editor, kid: string) {
  const k = editable(editor, kid);
  if (!k) return;
  editor.setPersonalView(k.id, myTabId(editor, k), null);
  editor.setPersonalView(k.id, MY_TAB_KEY, null);
}

const writeView = (editor: Editor, k: KanbanElement, view: ViewConfig) => editor.update<KanbanElement>(k.id, savedViews(k, view));

/**
 * "Save for everyone": my view becomes the saved one (one undo step) and my own changes are
 * cleared — the tab I look at becomes the tab everyone starts on, with my changes to it (the
 * board's fields shown and colour, or a table's columns, filter and sort). Editors, unlocked
 * kanbans, a tab not locked by someone else. A filter saying "is me" can't be saved: on the shared
 * board it would mean someone else for each person.
 */
export function saveViewForEveryone(editor: Editor, kid: string): boolean {
  const k = editable(editor, kid);
  if (!k || !editor.can('editor') || k.locked) return false;
  const tab = myTab(editor, k);
  const moveTab = (cur: KanbanElement) => {
    const patch = savedTabId(cur) !== tab.id ? withSavedTab(cur, tab.id) : null;
    if (patch) editor.update<KanbanElement>(cur.id, patch);
  };
  if (tab.layout === 'board') {
    if (!viewEditable(editor, k)) return false;
    const mine = viewOf(editor, k, true);
    editor.transact(() => {
      if (overrideBetween(boardView(k), mine)) writeView(editor, k, { ...mine, filter: cleanFilter(mine.filter) });
      moveTab(editor.getElement<KanbanElement>(k.id)!);
    });
  } else {
    const saved = projectionView(k, tab.id);
    if (!saved || viewLockedFor(saved, { id: editor.user.id, role: editor.can('owner') ? 'owner' : 'editor' })) return false;
    const mine = myView(editor, k, tab.id)!;
    editor.transact(() => {
      if (projectionOverrideBetween(saved, mine)) editor.update<KanbanElement>(k.id, withProjectionSaved(k, { ...mine, filter: cleanFilter(mine.filter) }));
      moveTab(editor.getElement<KanbanElement>(k.id)!);
    });
  }
  editor.setPersonalView(k.id, tab.id, null);
  editor.setPersonalView(k.id, MY_TAB_KEY, null);
  return true;
}

/** My own filter (null: none, even where the saved view has one): fades the cards it leaves out, for me. Any role. */
export function setMyFilter(editor: Editor, kid: string, filter: ViewFilter | null) {
  const k = editable(editor, kid);
  if (!k) return;
  const saved = boardView(k);
  const mine = viewOf(editor, k, true);
  editor.setPersonalView(k.id, saved.id, overrideBetween(saved, { ...mine, filter: cleanFilter(filter, { personal: true }) }) as Record<string, unknown> | null);
}

/**
 * Sorts every column by `sort` (empty: manual order again). Saved for everyone: it moves the real
 * cards. Starting a sort keeps the manual order in the view; clearing it brings that order back
 * (the layout restores it). One undo step with the re-stack.
 */
export function setSort(editor: Editor, kid: string, sort: SortRule[]): boolean {
  const k = editable(editor, kid);
  if (!k || !viewEditable(editor, k)) return false;
  const saved = boardView(k);
  const next = cleanSort(sort);
  if (JSON.stringify(next) === JSON.stringify(saved.sort ?? [])) return false;
  const manualOrder = saved.sort?.length ? saved.manualOrder : manualOrderOf(k, editor.getElements());
  const { sort: _s, ...rest } = saved;
  writeView(editor, k, { ...rest, ...(next.length ? { sort: next } : {}), ...(manualOrder ? { manualOrder } : {}) });
  return true;
}

/** Locks (or unlocks) the saved view: only whoever locked it and the board's owners change it then. Editors. */
export function setViewLocked(editor: Editor, kid: string, locked: boolean): boolean {
  const k = editable(editor, kid);
  if (!k || !editor.can('editor') || k.locked) return false;
  const saved = boardView(k);
  if (!!saved.locked === locked) return false;
  if (!locked && !viewEditable(editor, k)) return false;
  writeView(editor, k, { ...saved, locked: locked ? { by: editor.user.id } : null });
  return true;
}

/** Card density: changes the cards' size on the shared board, so it is saved for everyone (editors, one undo step with the re-stack). */
export function setDensity(editor: Editor, kid: string, density: CardDensity) {
  const k = editable(editor, kid);
  if (!k || !viewEditable(editor, k)) return;
  const saved = boardView(k);
  if (saved.card?.density === density) return;
  writeView(editor, k, { ...saved, card: { ...saved.card!, density } });
}
