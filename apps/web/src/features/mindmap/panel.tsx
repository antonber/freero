import { useEffect } from 'react';
import { definePanel } from '@engine';
import { installController } from './lib/controller';
import { EXPAND_DIALOG, FROM_STICKIES_DIALOG } from './lib/constants';
import { ExpandDialog, FromStickiesDialog } from './lib/dialogs';

export default [
  // Renders nothing: mounts the board-level mind-map controller (tree info, subtree drag,
  // re-layout on text-size changes, Enter/Delete on nodes). See lib/controller.ts.
  definePanel({
    id: 'mindmap.controller',
    slot: 'world-overlay',
    order: 0,
    Component: ({ editor }) => {
      useEffect(() => installController(editor), [editor]);
      return null;
    },
  }),
  definePanel({ id: EXPAND_DIALOG, slot: 'dialog', order: 62, minRole: 'editor', Component: ExpandDialog }),
  definePanel({ id: FROM_STICKIES_DIALOG, slot: 'dialog', order: 63, minRole: 'editor', Component: FromStickiesDialog }),
];
