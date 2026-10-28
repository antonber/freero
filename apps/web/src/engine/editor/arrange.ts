// Arrange pass: containers that lay out their children (kanban columns, frames with a grid
// layout) declare `ElementDefinition.arrange`. After a LOCAL change the engine asks every such
// container for the patches that put it back in layout and applies them in the same undo step:
//   - inside a gesture (drag, drag-create, text edit session) once, when the outermost gesture
//     ends — so nothing jumps under the pointer mid-drag, and the drop + re-stack is ONE undo;
//   - otherwise right after the write.
// Remote changes never run it, so exactly one client — the one making the change — re-lays out.
import type { ArrangeContext, ElementPatch } from '../api';
import type { EngineCore } from '../runtime/core';

export interface ArrangeState {
  /** Ids written or removed by local changes since the last pass. */
  touched: Set<string>;
  running: boolean;
  /** Open Editor.transact levels: the pass waits for the outermost to finish. */
  depth: number;
}

export const createArrangeState = (): ArrangeState => ({ touched: new Set(), running: false, depth: 0 });

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
  if (!state.touched.size || state.running) return;
  const touched: ReadonlySet<string> = new Set(state.touched);
  state.touched.clear();
  state.running = true;
  try {
    for (const { def, feature } of core.registry.elements.values()) {
      if (!def.arrange) continue;
      const ctx: ArrangeContext = { editor: core.scoped(feature), touched };
      for (const el of core.store.getOrderedOfType(def.type)) {
        const patches = def.arrange(el as never, ctx);
        if (patches?.length) apply(patches);
      }
    }
  } finally {
    state.running = false;
  }
}
