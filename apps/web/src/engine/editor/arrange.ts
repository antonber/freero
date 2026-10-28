// Arrange pass: containers that lay out their children (kanban columns, frames with a grid
// layout) declare `ElementDefinition.arrange`. After a LOCAL change the engine asks every such
// container for the patches that put it back in layout and applies them in the same undo step:
//   - inside a gesture (drag, drag-create, text edit session) once, when the outermost gesture
//     ends — so nothing jumps under the pointer mid-drag, and the drop + re-stack is ONE undo;
//   - otherwise right after the write.
// Remote changes never run it, so exactly one client — the one making the change — re-lays out.
import type { BoardElement } from '@freero/shared';
import type { ArrangeContext, ElementPatch } from '../api';
import type { EngineCore } from '../runtime/core';

export interface ArrangeState {
  /** Elements written/removed by local changes since the last pass, as they were before (null: created). */
  before: Map<string, BoardElement | null>;
  running: boolean;
  /** Open Editor.transact levels: the pass waits for the outermost to finish. */
  depth: number;
}

const MAX_ROUNDS = 3;

export const createArrangeState = (): ArrangeState => ({ before: new Map(), running: false, depth: 0 });

export function hasArrangers(core: EngineCore): boolean {
  for (const r of core.registry.elements.values()) if (r.def.arrange) return true;
  return false;
}

/**
 * Runs every arranger once over the touched ids and applies their patches through `apply`
 * (the editor's updateMany, so normalize/followers run and the writes share the undo step).
 */
export function runArrangers(
  core: EngineCore,
  state: ArrangeState,
  apply: (patches: Array<{ id: string; patch: ElementPatch }>) => void,
): void {
  if (!state.before.size || state.running) return;
  const previous: ReadonlyMap<string, BoardElement | null> = new Map(state.before);
  const touched: ReadonlySet<string> = new Set(previous.keys());
  state.before.clear();
  state.running = true;
  try {
    // A layout's own writes can change sizes (normalize: a card narrowed into a column grows
    // taller), so settle in a few rounds; idempotent arrangers return nothing once laid out.
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let wrote = false;
      for (const { def, feature } of core.registry.elements.values()) {
        if (!def.arrange) continue;
        const ctx: ArrangeContext = { editor: core.scoped(feature), touched, previous };
        for (const el of core.store.getOrderedOfType(def.type)) {
          const patches = def.arrange(el as never, ctx);
          if (patches?.length) {
            apply(patches);
            wrote = true;
          }
        }
      }
      if (!wrote) break;
    }
  } finally {
    state.running = false;
  }
}
