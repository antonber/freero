import { MessageSquare, MessageSquarePlus } from 'lucide-react';
import { defineCommands } from '@engine';
import { focusThread, getThread, PANEL_ID, replaceInMessages, startDraft } from './lib/state';

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
  {
    // For other features (find): open a thread by id, its pin brought into view. `quiet`: the
    // caller keeps the keyboard focus. runCommand('comments.openThread', { threadId, quiet? })
    id: 'comments.openThread',
    label: 'Open comment thread',
    minRole: 'viewer',
    run(editor, args) {
      const t = typeof args?.threadId === 'string' ? getThread(editor, args.threadId) : undefined;
      if (t) focusThread(editor, t, { quiet: args?.quiet === true });
    },
  },
  {
    // For other features (find & replace): replace text in your own comments (see
    // replaceInMessages). runCommand('comments.replaceText', { find, replacement, caseSensitive?,
    // only?: [{ threadId, messageId }] })
    id: 'comments.replaceText',
    label: 'Replace text in your comments',
    minRole: 'commenter',
    run(editor, args) {
      if (typeof args?.find !== 'string' || typeof args.replacement !== 'string') return;
      const only = Array.isArray(args.only)
        ? (args.only as unknown[]).filter(
            (m): m is { threadId: string; messageId: string } =>
              !!m && typeof (m as { threadId?: unknown }).threadId === 'string' && typeof (m as { messageId?: unknown }).messageId === 'string',
          )
        : undefined;
      replaceInMessages(editor, args.find, args.replacement, { caseSensitive: args.caseSensitive === true, only });
    },
  },
]);
