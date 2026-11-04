// Linked views (step 3c; the model is @freero/shared linkedViews.ts): a `kanbanview` element shows
// a kanban elsewhere on the board as a table, list, calendar or timeline. What it draws comes from
// the live cards; edits made in it write those cards (card.setValues, as a tab's do). Its settings
// follow owner decision 2 like a tab's: mine (personal view state under LINKED_VIEW_KEY, any role)
// until an editor saves them for everyone; renaming it, changing its layout and locking it are
// saved changes (editors, a view not locked by someone else).
import {
  LINKED_VIEW_KEY,
  LINKED_VIEW_SIZES,
  cleanFilter,
  cleanProjection,
  cleanProjectionOverride,
  linkedSource,
  linkedView,
  linkedViewNameProblem,
  newLinkedView,
  projectionOverrideBetween,
  viewLockedFor,
  withLinkedViewSaved,
  withProjectionOverride,
  type KanbanElement,
  type KanbanViewElement,
  type ProjectionLayout,
  type ProjectionOverride,
  type ProjectionView,
} from '@freero/shared';
import type { Editor, NewElement } from '@engine';
import { myView } from './tabs';

import { t } from '../messages';
const linkedOf = (editor: Pick<Editor, 'getElement'>, id: string): KanbanViewElement | null => {
  const el = editor.getElement<KanbanViewElement>(id);
  return el && el.type === 'kanbanview' ? el : null;
};

/** The selected linked view (exactly one item selected), or null. */
export function selectedLinkedView(editor: Pick<Editor, 'getSelection' | 'getElement'>): KanbanViewElement | null {
  const sel = editor.getSelection();
  return sel.length === 1 ? linkedOf(editor, sel[0]) : null;
}

/** The kanban linked view `lv` shows, when it is on the board for me (null: deleted, or not visible to me). */
export const sourceOf = (editor: Pick<Editor, 'getElement'>, lv: KanbanViewElement): KanbanElement | null => linkedSource(lv, (id) => editor.getElement(id));

/** Linked view `lv` as I see it: my own changes on top of its saved view. */
export const myLinkedView = (editor: Pick<Editor, 'getPersonalView'>, lv: KanbanViewElement): ProjectionView => withProjectionOverride(linkedView(lv), editor.getPersonalView(lv.id, LINKED_VIEW_KEY));

const who = (editor: Pick<Editor, 'can' | 'user'>) => ({ id: editor.user.id, role: editor.can('owner') ? ('owner' as const) : ('editor' as const) });

/** Whether I may change linked view `lv`'s saved view (an editor, the element unlocked, the view not locked by someone else). */
export function linkedEditable(editor: Pick<Editor, 'can' | 'user'>, lv: KanbanViewElement): boolean {
  return editor.can('editor') && !lv.locked && !viewLockedFor(linkedView(lv), who(editor));
}

/** True when I see linked view `lv` differently from what is saved. */
export function hasOwnLinkedView(editor: Pick<Editor, 'getPersonalView'>, lv: KanbanViewElement): boolean {
  return !!projectionOverrideBetween(linkedView(lv), myLinkedView(editor, lv));
}

/**
 * Adds a linked view of kanban `kid` beside it (right of it, or the nearest free spot), selected,
 * in one undo step: a `layout` view, or — `from` naming one of the kanban's projection tabs — that
 * tab as I see it (its settings and name). Editors. Returns its id.
 */
export function addLinkedView(editor: Editor, kid: string, layout: ProjectionLayout, opts: { name?: string; from?: string } = {}): string | null {
  const k = editor.getElement<KanbanElement>(kid);
  if (!k || k.type !== 'kanban' || !editor.can('editor') || !editor.mayAdd('kanbanview')) return null;
  const tab = opts.from ? myView(editor, k, opts.from) : null;
  const view = tab ? (cleanProjection({ ...tab, locked: null, filter: cleanFilter(tab.filter), ...(opts.name ? { name: opts.name } : {}) }) ?? newLinkedView(layout, opts.name)) : newLinkedView(layout, opts.name);
  const size = LINKED_VIEW_SIZES[view.layout];
  const spot = editor.findFreeSpot(size, { near: { x: k.x + k.w + 80 + size.w / 2, y: k.y + size.h / 2 }, gap: 40 });
  const el: NewElement<'kanbanview'> = { type: 'kanbanview', x: spot.x, y: spot.y, w: size.w, h: size.h, sourceId: k.id, ...withLinkedViewSaved(view) };
  return editor.create<'kanbanview'>(el, { select: true });
}

/** Changes linked view `id`'s settings for me only (any role), until I save them for everyone; settings its layout doesn't have are ignored. */
export function setMyLinkedView(editor: Editor, id: string, patch: ProjectionOverride | Record<string, unknown>): void {
  const lv = linkedOf(editor, id);
  if (!lv) return;
  const saved = linkedView(lv);
  const clean = cleanProjectionOverride(saved.layout, patch) ?? {};
  const next = cleanProjectionOverride(saved.layout, projectionOverrideBetween(saved, { ...myLinkedView(editor, lv), ...clean } as ProjectionView));
  editor.setPersonalView(lv.id, LINKED_VIEW_KEY, next as Record<string, unknown> | null);
}

/** Back to linked view `id`'s saved view. */
export function resetMyLinkedView(editor: Editor, id: string): void {
  editor.setPersonalView(id, LINKED_VIEW_KEY, null);
}

/** "Save for everyone": my view of linked view `id` becomes its saved view (one undo step); my changes are cleared. A filter saying "is me" can't be saved. */
export function saveLinkedViewForEveryone(editor: Editor, id: string): boolean {
  const lv = linkedOf(editor, id);
  if (!lv || !linkedEditable(editor, lv)) return false;
  const mine = myLinkedView(editor, lv);
  if (projectionOverrideBetween(linkedView(lv), mine)) editor.update<KanbanViewElement>(lv.id, withLinkedViewSaved({ ...mine, filter: cleanFilter(mine.filter) }));
  resetMyLinkedView(editor, lv.id);
  return true;
}

/** Renames linked view `id` for everyone; returns why it can't be (an empty name), or null. */
export function renameLinkedView(editor: Editor, id: string, name: string): string | null {
  const lv = linkedOf(editor, id);
  if (!lv || !linkedEditable(editor, lv)) return t('youCanTRenameThis2');
  const problem = linkedViewNameProblem(name);
  if (problem) return problem;
  const saved = linkedView(lv);
  if (name.trim() !== saved.name) editor.update<KanbanViewElement>(lv.id, withLinkedViewSaved({ ...saved, name: name.trim() }));
  return null;
}

/**
 * Shows linked view `id` as another layout, for everyone (editors; one undo step): its filter,
 * sort and name carry over (a name that was the old layout's becomes the new one's), the old
 * layout's own settings don't; my own changes are cleared.
 */
export function setLinkedLayout(editor: Editor, id: string, layout: ProjectionLayout): boolean {
  const lv = linkedOf(editor, id);
  if (!lv || !linkedEditable(editor, lv)) return false;
  const saved = linkedView(lv);
  if (saved.layout === layout) return false;
  const fresh = newLinkedView(layout);
  const name = saved.name === newLinkedView(saved.layout).name ? fresh.name : saved.name;
  editor.update<KanbanViewElement>(lv.id, withLinkedViewSaved({ ...fresh, name, ...(saved.filter ? { filter: saved.filter } : {}), ...(saved.sort?.length ? { sort: saved.sort } : {}), ...(saved.locked ? { locked: saved.locked } : {}) } as ProjectionView));
  resetMyLinkedView(editor, lv.id);
  return true;
}

/** Locks (or unlocks) linked view `id`'s saved view: only whoever locked it and the board's owners change it then. Editors. */
export function setLinkedLocked(editor: Editor, id: string, locked: boolean): boolean {
  const lv = linkedOf(editor, id);
  if (!lv || !editor.can('editor') || lv.locked) return false;
  const saved = linkedView(lv);
  if (!!saved.locked === locked) return false;
  if (!locked && viewLockedFor(saved, who(editor))) return false;
  editor.update<KanbanViewElement>(lv.id, withLinkedViewSaved({ ...saved, locked: locked ? { by: editor.user.id } : null }));
  return true;
}

/** Whether cards can be changed through linked view `lv` (showing `k`): an editor, the kanban and the view element unlocked. Cards keep their own lock. */
export const linkedCardsEditable = (canEdit: boolean, k: KanbanElement, lv: KanbanViewElement): boolean => canEdit && !k.locked && !lv.locked;
