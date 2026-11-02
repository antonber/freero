// The kanban's board view (docs/design/kanban-fields-and-views.md, step 2b): what its cards show
// and how they are coloured. Two layers: the SAVED view on the element (`views`, written by
// editors, what everyone starts from) and this person's own changes on top of it (a personal
// override, Editor.setPersonalView: any role, never in the doc). Changing which fields show or
// what colours cards changes only my view until I "Save for everyone"; density changes the cards'
// size on the shared board, so it is saved directly (editors).
import {
  boardView,
  cardAccent,
  cardChips,
  collectionSchema,
  overrideBetween,
  savedViews,
  withOverride,
  type BoardElement,
  type CardColorBy,
  type CardDensity,
  type KanbanElement,
  type ViewConfig,
} from '@freero/shared';
import type { ChildPresentation, Editor } from '@engine';

/** The kanban's board view, with this person's own changes when `personal`. */
export function viewOf(editor: Pick<Editor, 'getPersonalView'>, k: KanbanElement, personal: boolean): ViewConfig {
  const saved = boardView(k);
  return personal ? withOverride(saved, editor.getPersonalView(k.id, saved.id)) : saved;
}

/** True when this person sees the board view differently from what is saved. */
export const hasOwnView = (editor: Pick<Editor, 'getPersonalView'>, k: KanbanElement) => !!overrideBetween(boardView(k), viewOf(editor, k, true));

/** How a card on kanban `k` is shown: its accent (derived, never written), chips and density. */
export function presentCard(k: KanbanElement, child: BoardElement, editor: Pick<Editor, 'getPersonalView'>, personal: boolean): ChildPresentation | null {
  if (child.type !== 'card' || child.frameId !== k.id) return null;
  const view = viewOf(editor, k, personal);
  const schema = collectionSchema(k);
  return { accent: cardAccent(k, child, view, schema), chips: cardChips(k, child, view, schema), density: view.card?.density ?? 'comfortable' };
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
  if (k) editor.setPersonalView(k.id, boardView(k).id, null);
}

const writeView = (editor: Editor, k: KanbanElement, view: ViewConfig) => editor.update<KanbanElement>(k.id, savedViews(k, view));

/** "Save for everyone": my view becomes the saved one (one undo step) and my own changes are cleared. Editors, unlocked kanbans. */
export function saveViewForEveryone(editor: Editor, kid: string): boolean {
  const k = editable(editor, kid);
  if (!k || k.locked || !editor.can('editor')) return false;
  const mine = viewOf(editor, k, true);
  writeView(editor, k, mine);
  editor.setPersonalView(k.id, mine.id, null);
  return true;
}

/** Card density: changes the cards' size on the shared board, so it is saved for everyone (editors, one undo step with the re-stack). */
export function setDensity(editor: Editor, kid: string, density: CardDensity) {
  const k = editable(editor, kid);
  if (!k || k.locked) return;
  const saved = boardView(k);
  if (saved.card?.density === density) return;
  writeView(editor, k, { ...saved, card: { ...saved.card!, density } });
}
