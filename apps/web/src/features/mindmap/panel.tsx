import { useEffect } from 'react';
import { definePanel } from '@engine';
import { installController } from './lib/controller';

// Renders nothing: mounts the board-level mind-map controller (tree info, subtree drag,
// re-layout on text-size changes, Enter/Delete on nodes). See lib/controller.ts.
export default definePanel({
  id: 'mindmap.controller',
  slot: 'world-overlay',
  order: 0,
  Component: ({ editor }) => {
    useEffect(() => installController(editor), [editor]);
    return null;
  },
});
