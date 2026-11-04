// Dependencies (#50): "A blocks B" between two linked issues, kept in step with connectors between
// their cards — a synced RELATION, not a field of one issue. Pure over a board view.
//
// On the board a dependency is a connector from a card of A to a card of B with an arrowhead at
// B's end only (the Dependency style: dashed, arrow at the end) — A comes first, B waits on it. A
// connector without one arrowhead, or between items that aren't both linked task cards of the same
// connection, means nothing to the tracker. In the tracker it is the provider's own "blocks" link
// (Jira issue links of type Blocks, Linear relations, GitHub issue dependencies, ClickUp
// dependencies).
//
// The merge is per pair against what both sides last agreed on (`tracker_relations`): one that
// appeared or went on ONE side since flows to the other; both sides agreeing is agreement whatever
// it was before. A pair is agreed only once what the sync wrote for it has been written, so a
// change on either side while the sync ran is seen by the next one.
import { connectorDraft, type BoardElement, type ConnectorElement, type ElementDraft } from '@freero/shared';


/** "blocker>blocked", by link id. */
export type Pair = `${string}>${string}`;
export const pairOf = (blocker: string, blocked: string): Pair => `${blocker}>${blocked}`;
export const partsOf = (p: Pair): [string, string] => p.split('>') as [string, string];

const arrow = (cap: unknown) => typeof cap === 'string' && cap !== 'none';

/**
 * The dependencies a board draws between linked cards: each connector with one arrowhead whose
 * ends are cards of two different links, read as tail-blocks-head. `linkOf`: an item's link (of
 * the connection being synced), else undefined.
 */
export function boardPairs(view: { elements: ReadonlyArray<{ el: BoardElement }> }, linkOf: (itemId: string) => string | undefined): Map<Pair, string[]> {
  const byId = new Map(view.elements.map((e) => [e.el.id, e.el]));
  const out = new Map<Pair, string[]>();
  for (const { el } of view.elements) {
    if (el.type !== 'connector') continue;
    const c = el as ConnectorElement;
    const a = c.start.elementId ?? null;
    const b = c.end.elementId ?? null;
    if (!a || !b) continue;
    const head = arrow(c.endCap) && !arrow(c.startCap) ? 'end' : arrow(c.startCap) && !arrow(c.endCap) ? 'start' : null;
    if (!head) continue;
    const [from, to] = head === 'end' ? [a, b] : [b, a];
    if (byId.get(from)?.type !== 'card' || byId.get(to)?.type !== 'card') continue;
    const lf = linkOf(from);
    const lt = linkOf(to);
    if (!lf || !lt || lf === lt) continue;
    const p = pairOf(lf, lt);
    out.set(p, [...(out.get(p) ?? []), c.id]);
  }
  return out;
}

export interface RelationPlan {
  /** Write to the tracker. */
  add: Pair[];
  remove: Pair[];
  /** Draw on the board / take off it. */
  draw: Pair[];
  erase: Pair[];
  /** What both sides agree on once those are done (the pairs the merge looked at). */
  agreed: Pair[];
}

/**
 * One link's dependencies merged: `board` and `tracker` hold the pairs each side has now that
 * involve the link, `agreed` the ones both last agreed on.
 */
export function planRelations(board: ReadonlySet<Pair>, tracker: ReadonlySet<Pair>, agreed: ReadonlySet<Pair>): RelationPlan {
  const out: RelationPlan = { add: [], remove: [], draw: [], erase: [], agreed: [] };
  for (const p of new Set([...board, ...tracker, ...agreed])) {
    const b = board.has(p);
    const t = tracker.has(p);
    const was = agreed.has(p);
    if (b === t) {
      if (b) out.agreed.push(p);
    } else if (b) {
      // On the board only: made there since (send it), or removed in the tracker since (take it off).
      if (was) out.erase.push(p);
      else {
        out.add.push(p);
        out.agreed.push(p);
      }
    } else if (was) out.remove.push(p);
    else {
      out.draw.push(p);
      out.agreed.push(p);
    }
  }
  return out;
}

/**
 * A dependency connector from `from` to `to` (Dependency style: dashed, an arrow at the end),
 * leaving and entering by the sides that face each other (a bar before another: its end to the
 * other's start; cards in one column: bottom to top).
 */
export function dependencyConnector(id: string, from: BoardElement, to: BoardElement): ElementDraft {
  type Side = 'left' | 'right' | 'top' | 'bottom';
  const [a, b]: [Side, Side] =
    to.x >= from.x + from.w ? ['right', 'left'] : to.x + to.w <= from.x ? ['left', 'right'] : to.y >= from.y + from.h ? ['bottom', 'top'] : ['top', 'bottom'];
  return connectorDraft(id, { id: from.id, rect: { x: from.x, y: from.y, w: from.w, h: from.h }, anchor: a }, { id: to.id, rect: { x: to.x, y: to.y, w: to.w, h: to.h }, anchor: b }, { strokeStyle: 'dashed', startCap: 'none', endCap: 'arrow', routing: 'elbow' });
}
