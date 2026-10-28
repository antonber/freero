// Arrange pass: containers that lay out their children (kanban columns, frames with a grid
// layout) declare `ElementDefinition.arrange`. After a LOCAL change the engine asks every such
// container for the patches that put it back in layout and applies them in the same undo step:
//   - inside a gesture (drag, drag-create, text edit session) once, when the outermost gesture
//     ends — so nothing jumps under the pointer mid-drag, and the drop + re-stack is ONE undo;
//   - otherwise right after the write.
// So the client making a change re-lays out, and remote changes normally arrive laid out.
//
// Concurrent changes (KAI-75): two people dropping into the same column at the same moment each
// stack their own item into the same free slot; the merge overlaps. Layouts are deterministic
// (the same board state gives the same patches on every client), so the fix is to re-run the
// pass on the merged state — but only by the clients that took part, never by bystanders (a
// bystander would also "fix" another person's drag in progress), and only one of them:
//   - a client that laid out a container in the last CONFLICT_WINDOW_MS watches remote changes;
//     once they have been quiet for REMOTE_SETTLE_MS it plans that container on the merged state;
//   - if it is out of layout, the client with the highest Yjs client id among itself and the
//     writers of the remote changes re-lays it out now; the others look again after
//     FALLBACK_MS (the winner may have left) and normally find it already laid out;
//   - the fix is idempotent: on every client the pass then finds nothing to do, so it can't
//     ping-pong. Its undo joins the fixer's last step (BoardStore.transactDerived).
import type { BoardElement } from '@freero/shared';
import type { ArrangeContext, ElementPatch } from '../api';
import type { EngineCore } from '../runtime/core';

export interface ArrangeState {
  /** Elements written/removed by local changes since the last pass, as they were before (null: created). */
  before: Map<string, BoardElement | null>;
  running: boolean;
  /** Open Editor.transact levels: the pass waits for the outermost to finish. */
  depth: number;
  /** Containers this client laid out recently -> when (they may meet a concurrent change). */
  recent: Map<string, number>;
  /** Elements changed remotely since the last re-check of `recent` containers. */
  remote: Set<string>;
  remoteTimer: ReturnType<typeof setTimeout> | null;
}

const MAX_ROUNDS = 3;
export const CONFLICT_WINDOW_MS = 5000;
export const REMOTE_SETTLE_MS = 250;
export const FALLBACK_MS = 1500;

export const createArrangeState = (): ArrangeState => ({
  before: new Map(),
  running: false,
  depth: 0,
  recent: new Map(),
  remote: new Set(),
  remoteTimer: null,
});

export function hasArrangers(core: EngineCore): boolean {
  for (const r of core.registry.elements.values()) if (r.def.arrange) return true;
  return false;
}

type Apply = (patches: Array<{ id: string; patch: ElementPatch }>) => void;

/**
 * Runs every arranger once over the touched ids and applies their patches through `apply`
 * (the editor's updateMany, so normalize/followers run and the writes share the undo step).
 */
export function runArrangers(core: EngineCore, state: ArrangeState, apply: Apply): void {
  if (!state.before.size || state.running) return;
  const previous: ReadonlyMap<string, BoardElement | null> = new Map(state.before);
  state.before.clear();
  arrange(core, state, new Set(previous.keys()), previous, null, apply);
}

/**
 * The containers among `only` that the merged board leaves out of layout (nothing is written).
 * Plans as a pass after a remote change would: no `previous`, `touched` = the remote ids.
 */
export function outOfLayout(core: EngineCore, only: ReadonlySet<string>, touched: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const { def, feature } of core.registry.elements.values()) {
    if (!def.arrange) continue;
    const ctx: ArrangeContext = { editor: core.scoped(feature), touched, previous: new Map() };
    for (const el of core.store.getOrderedOfType(def.type)) if (only.has(el.id) && def.arrange(el as never, ctx)?.length) out.push(el.id);
  }
  return out;
}

/** Re-lays out just `only` on the merged board (see the header). */
export function rearrange(core: EngineCore, state: ArrangeState, only: ReadonlySet<string>, touched: ReadonlySet<string>, apply: Apply): void {
  if (state.running) return;
  arrange(core, state, touched, new Map(), only, apply);
}

function arrange(
  core: EngineCore,
  state: ArrangeState,
  touched: ReadonlySet<string>,
  previous: ReadonlyMap<string, BoardElement | null>,
  only: ReadonlySet<string> | null,
  apply: Apply,
): void {
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
          if (only && !only.has(el.id)) continue;
          const patches = def.arrange(el as never, ctx);
          if (patches?.length) {
            apply(patches);
            state.recent.set(el.id, Date.now());
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
