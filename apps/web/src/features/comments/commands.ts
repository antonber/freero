import { defineCommands } from '@engine';
import { PANEL_ID, startDraft } from './lib/state';

export default defineCommands([
  {
    id: 'comments.togglePanel',
    label: 'Comments',
    menus: ['board'],
    minRole: 'viewer',
    run: (editor) => editor.openDock(editor.getDock() === PANEL_ID ? null : PANEL_ID),
  },
  {
    // Right-click an item → comment on it (pinned to its top-right corner).
    id: 'comments.commentOnItem',
    label: 'Add comment',
    menus: ['context'],
    minRole: 'commenter',
    when: (editor) => editor.getSelection().length === 1,
    run(editor) {
      const el = editor.getElement(editor.getSelection()[0]);
      if (!el) return;
      startDraft(editor, { x: el.w, y: 0, elementId: el.id });
    },
  },
]);
