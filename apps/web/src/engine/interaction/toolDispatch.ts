// Hands pointer events to the active tool. Creation tools get grid points while the board's grid
// snapping applies (ToolDefinition.snapToGrid), and elements they create meanwhile land on the
// grid (EditorImpl.createMany reads `core.interaction.createGrid`).
import type { ToolDefinition, ToolPointerEvent } from '../api';
import { gridStepFor, snapPointToGrid } from '../geometry/snap';
import type { EngineCore } from '../runtime/core';
import type { Registered } from '../runtime/registry';

export type ToolPointerHandler = 'onPointerDown' | 'onPointerMove' | 'onPointerUp';

/**
 * Calls `tool.def[kind]` with `ev` (raw world point), its `point` moved onto the grid when grid
 * snapping applies; `target` stays what is under the real pointer.
 */
export function dispatchToolPointer(core: EngineCore, tool: Registered<ToolDefinition>, kind: ToolPointerHandler, ev: ToolPointerEvent): void {
  const handler = tool.def[kind];
  if (!handler) return;
  const grid = tool.def.snapToGrid === false ? undefined : gridStepFor(core.store.getSettings(), ev);
  if (grid) ev.point = snapPointToGrid(ev.point, grid);
  core.interaction.createGrid = grid;
  try {
    handler.call(tool.def, ev);
  } finally {
    core.interaction.createGrid = undefined;
  }
}
