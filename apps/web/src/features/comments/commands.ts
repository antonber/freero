import { MessageSquare, MessageSquarePlus } from 'lucide-react';
import { defineCommands } from '@engine';
import { PANEL_ID, startDraft } from './lib/state';

export default defineCommands([
  {
    id: 'comments.togglePanel',
    label: 'Comments',
    icon: MessageSquare,
    menus: ['board'],
    minRole: 'viewer',
    run: (editor) => editor.openDock(editor.getDock() === PANEL_ID ? null : PANEL_ID),
  },
  {
    // Right-click an item → comment on it, pinned just outside its top-right corner (clear of
    // its content and handles, and following it when it is resized).
    id: 'comments.commentOnItem',
    label: 'Add comment',
    icon: MessageSquarePlus,
    menus: ['context'],
    minRole: 'commenter',
    when: (editor) => editor.getSelection().length === 1,
    run(editor) {
      const el = editor.getElement(editor.getSelection()[0]);
      if (!el) return;
      startDraft(editor, { x: el.w, y: 0, elementId: el.id, corner: 'top-right' });
    },
  },
]);
