// Where elements live: the shared doc, this user's private layer, or the editors layer (see
// "Board layers" in ARCHITECTURE.md). One rule, applied to every local element write:
//
//   1. In the private layer already      -> stays private (until the server reveals it).
//   2. New, and private mode's rule says  -> private (Editor.setPrivatePlacement).
//   3. Inside a container that hides its  -> editors layer (a hidden frame: only owners/editors
//      contents (hidesContents)               can read it; the server never sends it to others).
//   4. Otherwise                          -> shared.
//
// Rule 3 also has to hold when the CONTAINER changes (a frame hidden / shown / deleted) or when a
// collaborator's write races ours, so every owner/editor client re-checks shared and editors
// elements after each change and moves the misplaced ones (silently: a derived write, like
// follower refreshes). Several editors doing the same move write identical values.
//
// Reveal racing with an edit: the server moves a private element into the shared doc while its
// author (maybe on another instance) is still editing it; the edit lands in the private layer
// after the reveal deleted it there. The author's client (the only one that can see it) then holds
// the same id in both docs, and publishes its newer private copy over the revealed one.
//
// Presence (KAI-80): while private mode applies to this user, others must not learn WHERE they
// draft either. `publicCursor` withholds the cursor while it is over the user's own private content
// or where a new item would go private; selection and editing ids never name private elements.
import type { BoardElement, PresenceState } from '@freero/shared';
import type { EngineCore } from '../runtime/core';
import type { ElementLayer, Point } from '../api';
import { elementAABB, rectCenter } from '../geometry/geometry';

const MAX_DEPTH = 16;

/** The container `el` belongs to: its frameId, or (not adopted yet) the one under its center. */
function containerOf(core: EngineCore, el: BoardElement, isNew: boolean): BoardElement | undefined {
  if (el.frameId) return core.store.getElement(el.frameId);
  if (!isNew || core.editor.getDefinition(el.type)?.container) return undefined;
  return core.editor.containerAt(rectCenter(elementAABB(el))) ?? undefined;
}

/** True when a container around `el` hides its contents from non-editors. */
export function insideHiddenContainer(core: EngineCore, el: BoardElement, isNew = false): boolean {
  let cur = containerOf(core, el, isNew);
  for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
    const def = core.editor.getDefinition(cur.type);
    if (def?.hidesContents?.(cur as never)) return true;
    cur = cur.frameId ? core.store.getElement(cur.frameId) : undefined;
  }
  return false;
}

/** The cursor others may see for a pointer at `world` (null: withheld, see the header). */
export function publicCursor(core: EngineCore, world: Point | null): PresenceState['cursor'] {
  if (!world) return null;
  const rule = core.editor.getPrivateRule();
  if (rule) {
    // "Where a new sticky would go private" (whole board, or inside the private-mode frame).
    const probe = { id: '', type: 'sticky', x: world.x - 1, y: world.y - 1, w: 2, h: 2, z: 0, rotation: 0 } as unknown as BoardElement;
    if (rule(probe)) return null;
  }
  const hit = core.editor.hitTest(world);
  if (hit && core.store.layerOf(hit.id) === 'private') return null;
  return { x: Math.round(world.x), y: Math.round(world.y) };
}

/** Ids others may see in this user's presence (never private elements'). */
export function publicIds(core: EngineCore, ids: string[]): string[] {
  return ids.filter((id) => core.store.layerOf(id) !== 'private');
}

export function installLayerPlacement(core: EngineCore, privateRule: () => ((el: BoardElement) => boolean) | null): () => void {
  const { store } = core;
  store.setPlacement((el, current) => {
    if (current === 'private') return 'private';
    const rule = privateRule();
    if (!current && rule?.(el)) return 'private';
    return insideHiddenContainer(core, el, !current) ? 'editors' : 'shared';
  });

  const hidingTypes = [...core.registry.elements.values()].filter((r) => r.def.hidesContents).map((r) => r.def);
  const anyHidingContainer = () =>
    hidingTypes.some((def) => store.getOrderedOfType(def.type).some((el) => def.hidesContents!(el as never)));

  let queued = false;
  const sweep = () => {
    queued = false;
    if (!core.editor.can('editor')) return;
    // This user's private copy of an element that is shared now (see "reveal racing" above).
    const revealed = store.duplicatedInLayers().filter((d) => d.layer === 'private');
    if (revealed.length) {
      store.transactSilently(() => {
        for (const { id } of revealed) {
          const mine = store.layers.private.elements.get(id);
          if (mine && JSON.stringify(mine) !== JSON.stringify(store.elements.get(id))) store.moveElement(mine, 'shared');
          else store.dropLayerCopy(id, 'private');
        }
      });
    }
    // Fast path (every drag frame lands here): nothing hidden and nothing to bring back.
    if (!store.layers.editors.elements.size && !anyHidingContainer()) return;
    const moves: Array<[BoardElement, ElementLayer]> = [];
    for (const el of store.getOrdered()) {
      const cur = store.layerOf(el.id);
      if (cur === 'private' || !cur) continue;
      const want: ElementLayer = insideHiddenContainer(core, el) ? 'editors' : 'shared';
      if (want !== cur) moves.push([el, want]);
    }
    const stale = store.duplicatedInLayers().filter((d) => d.layer === 'editors');
    if (!moves.length && !stale.length) return;
    store.transactSilently(() => {
      for (const d of stale) store.dropLayerCopy(d.id, d.layer);
      for (const [el, layer] of moves) store.moveElement(el, layer);
    });
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(sweep);
  };
  const offElements = store.subscribeElements(schedule);
  const offRole = store.subscribeRole(schedule);
  schedule();
  return () => {
    offElements();
    offRole();
  };
}
