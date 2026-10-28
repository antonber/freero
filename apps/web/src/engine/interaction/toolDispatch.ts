// Hands pointer events to the active tool. Creation tools get grid points while the board's grid
// snapping applies (ToolDefinition.snapToGrid), and elements they create meanwhile land on the
// grid (EditorImpl.createMany reads `core.interaction.createGrid`). `toolGhostAt` predicts the
// same placement for hover previews, so a ghost sits exactly where a click puts the item.
import type { Point, ToolDefinition, ToolPointerEvent } from '../api';
import { gridStepFor, snapPointToGrid } from '../geometry/snap';
import type { EngineCore } from '../runtime/core';
import type { Registered } from '../runtime/registry';

export type ToolPointerHandler = 'onPointerDown' | 'onPointerMove' | 'onPointerUp';

/** Grid step the tool's pointer events snap to with these modifiers, or undefined. */
function toolGrid(core: EngineCore, tool: Registered<ToolDefinition> | undefined, mods: { metaKey: boolean; altKey: boolean }) {
  return !tool || tool.def.snapToGrid === false ? undefined : gridStepFor(core.store.getSettings(), mods);
}

/**
 * Calls `tool.def[kind]` with `ev` (raw world point), its `point` moved onto the grid when grid
 * snapping applies; `target` stays what is under the real pointer.
 */
export function dispatchToolPointer(core: EngineCore, tool: Registered<ToolDefinition>, kind: ToolPointerHandler, ev: ToolPointerEvent): void {
  const handler = tool.def[kind];
  if (!handler) return;
  const grid = toolGrid(core, tool, ev);
  if (grid) ev.point = snapPointToGrid(ev.point, grid);
  core.interaction.createGrid = grid;
  try {
    handler.call(tool.def, ev);
  } finally {
    core.interaction.createGrid = undefined;
  }
}

/**
 * Top-left of a `size` box centered on the pointer, where the active tool would create it on a
 * click now: the point snapped like the tool's `point`, then the box's top-left on the grid like
 * `createMany`. Null while the pointer is off the canvas.
 */
export function toolGhostAt(core: EngineCore, size: { w: number; h: number }): Point | null {
  const { world, inside, mods } = core.pointer.getState();
  if (!inside || !world) return null;
  const grid = toolGrid(core, core.registry.toolsById.get(core.ui.getState().toolId), mods);
  if (!grid) return { x: world.x - size.w / 2, y: world.y - size.h / 2 };
  const c = snapPointToGrid(world, grid);
  return snapPointToGrid({ x: c.x - size.w / 2, y: c.y - size.h / 2 }, grid);
}
