// Built-in tools: select (V), hand (H) and the lasso (#111: select by drawing a loop; in the "+"
// grid and the pen's flyout). Panning itself is handled by the pointer router, which treats the
// hand tool, Space+drag and middle mouse identically.
import { Hand } from 'lucide-react';
import type { ToolDefinition } from '../api';
import type { EngineCore } from '../runtime/core';
import { LassoOptions } from '../ui/LassoOptions';
import { createSelectTool } from './selectTool';

export function createBuiltinTools(core: EngineCore): ToolDefinition[] {
  return [
    createSelectTool(core),
    {
      id: 'hand',
      label: 'Hand',
      icon: Hand,
      shortcut: 'h',
      order: 1,
      placement: 'main',
      minRole: 'viewer',
      cursor: 'grab',
    },
    { ...createSelectTool(core, 'lasso'), Options: LassoOptions },
  ];
}
