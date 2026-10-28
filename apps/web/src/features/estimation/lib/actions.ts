// Editor-bound planning poker actions (only this feature's scoped editor writes `estimation`).
import { nanoid } from 'nanoid';
import type { BoardElement } from '@freero/shared';
import type { Editor } from '@engine';
import { ROUND_KEY, itemPrefix, readRound, voteKey, type Deck, type Estimate, type EstimationValue, type Round } from './model';

export const COLLECTION = 'estimation';
/** What can be estimated. */
export const ESTIMABLE = new Set(['card', 'sticky']);

const shared = (editor: Editor) => editor.collection<EstimationValue>(COLLECTION);
/** My sealed picks: the server sends them to nobody else until the item is revealed. */
const sealed = (editor: Editor) => editor.privateCollection<EstimationValue>(COLLECTION);

export const getRound = (editor: Pick<Editor, 'collection'>) => readRound(editor.collection<EstimationValue>(COLLECTION).get(ROUND_KEY));

export const currentItem = (round: Round) => round.itemIds[round.index] ?? null;

/** The starter runs the round; the board owner may too (and any editor may end a stale one). */
export function canManage(editor: Editor, round: Round): boolean {
  return editor.can('editor') && (round.startedBy === editor.user.id || editor.getRole() === 'owner');
}

/** Selected cards and stickies (in reading order), else every card on the board. */
export function itemsToEstimate(editor: Editor): BoardElement[] {
  const byPos = (a: BoardElement, b: BoardElement) => a.y - b.y || a.x - b.x;
  const picked = editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is BoardElement => !!el && ESTIMABLE.has(el.type));
  if (picked.length) return picked.sort(byPos);
  return editor
    .getElements()
    .filter((el) => el.type === 'card' && !editor.isViewHidden(el.id))
    .sort(byPos);
}

export function start(editor: Editor, itemIds: string[], deck: Deck): void {
  if (!editor.can('editor') || !itemIds.length) return;
  // Picks of a round that never got revealed: dropped, never shown.
  editor.discardPrivate(COLLECTION);
  const round: Round = {
    id: nanoid(10),
    itemIds,
    index: 0,
    deck,
    revealed: false,
    startedBy: editor.user.id,
    startedByName: editor.user.name,
    startedAt: editor.host.serverNow(),
  };
  // One update: the old round's estimates disappear together with the new round appearing.
  editor.transact(() => {
    for (const [key] of shared(editor).entries()) shared(editor).delete(key);
    shared(editor).set(ROUND_KEY, round);
  });
  focusItem(editor, round);
}

/** Picks (or, with the same value again, takes back) my card for the current item. */
export function pick(editor: Editor, value: string): void {
  const round = getRound(editor);
  const itemId = round && currentItem(round);
  if (!round || !itemId || round.revealed || !editor.can('editor') || !round.deck.values.includes(value)) return;
  const key = voteKey(round.id, itemId, editor.user.id);
  const me = { roundId: round.id, itemId, userId: editor.user.id, userName: editor.user.name, userColor: editor.user.color };
  const mine = sealed(editor).get(key) as Estimate | undefined;
  if (mine?.value === value) {
    sealed(editor).delete(key);
    shared(editor).delete(key);
    return;
  }
  sealed(editor).set(key, { ...me, value } satisfies Estimate);
  if (!(shared(editor).get(key) as Estimate | undefined)?.sealed) shared(editor).set(key, { ...me, sealed: true } satisfies Estimate);
}

/** My pick for the current item (from my private layer). */
export function myPick(editor: Editor, round: Round): string | null {
  const itemId = currentItem(round);
  const e = itemId ? (sealed(editor).get(voteKey(round.id, itemId, editor.user.id)) as Estimate | undefined) : undefined;
  return e?.value ?? null;
}

export function reveal(editor: Editor): void {
  const round = getRound(editor);
  const itemId = round && currentItem(round);
  if (!round || !itemId || round.revealed || !canManage(editor, round)) return;
  // The server moves every voter's pick into the shared collection (replacing the markers) before
  // the round reads as revealed: nobody ever sees half of the cards.
  editor.revealPrivate(COLLECTION, { prefix: itemPrefix(round.id, itemId) });
  shared(editor).set(ROUND_KEY, { ...round, revealed: true });
}

/** Back to picking for the current item: everyone's cards are cleared. */
export function revote(editor: Editor): void {
  const round = getRound(editor);
  const itemId = round && currentItem(round);
  if (!round || !itemId || !canManage(editor, round)) return;
  editor.discardPrivate(COLLECTION, { prefix: itemPrefix(round.id, itemId) });
  editor.transact(() => {
    for (const [key] of shared(editor).entries()) if (key.startsWith(itemPrefix(round.id, itemId))) shared(editor).delete(key);
    shared(editor).set(ROUND_KEY, { ...round, revealed: false });
  });
}

export function goTo(editor: Editor, index: number): void {
  const round = getRound(editor);
  if (!round || !canManage(editor, round)) return;
  const i = Math.max(0, Math.min(round.itemIds.length - 1, index));
  if (i === round.index) return;
  const itemId = round.itemIds[i];
  const done = shared(editor)
    .entries()
    .some(([k, v]) => k.startsWith(itemPrefix(round.id, itemId)) && typeof (v as Estimate).value === 'string');
  const next = { ...round, index: i, revealed: done };
  shared(editor).set(ROUND_KEY, next);
  focusItem(editor, next);
}

/** Writes the agreed value onto the item: a card's estimate field (one undo step). */
export function accept(editor: Editor, value: string): void {
  const round = getRound(editor);
  const itemId = round && currentItem(round);
  if (!round || !itemId || !canManage(editor, round)) return;
  if (editor.getElement(itemId)?.type !== 'card') return;
  editor.runCommand('card.setEstimate', { id: itemId, value });
  editor.host.notify(`Estimate ${value} saved on the card`, 'success');
}

export function end(editor: Editor): void {
  if (!editor.can('editor') || !getRound(editor)) return;
  editor.discardPrivate(COLLECTION);
  editor.transact(() => {
    for (const [key] of shared(editor).entries()) shared(editor).delete(key);
  });
}

function focusItem(editor: Editor, round: Round): void {
  const id = currentItem(round);
  if (id && editor.getElement(id)) editor.zoomToFit([id], { maxZoom: 1.5, padding: 160 });
}
