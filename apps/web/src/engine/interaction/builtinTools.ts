// Built-in tools: select (V) and hand (H). Panning itself is handled by the pointer router,
// which treats the hand tool, Space+drag and middle mouse identically.
import { Hand } from 'lucide-react';
import type { ToolDefinition } from '../api';
import type { EngineCore } from '../runtime/core';
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
  ];
}
