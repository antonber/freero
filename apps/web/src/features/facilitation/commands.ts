import { MousePointer2, Presentation, X } from 'lucide-react';
import { defineCommands } from '@engine';
import { canManage, change, end, getSession, patchFromArgs, start, useCursorPrefs } from './lib/session';

export default defineCommands([
  {
    id: 'facilitation.start',
    icon: Presentation,
    label: 'Facilitate this session',
    menus: ['board'],
    when: (editor) => !getSession(editor),
    disabledReason: 'Someone is already facilitating',
    // Args (other features, e.g. a retro): the controls to start with ({ locked, allowedTypes, follow, cursorsHidden }).
    run: (editor, args) => start(editor, patchFromArgs(args)),
  },
  {
    // For other features driving a session they started (no menus: not a user-facing action).
    id: 'facilitation.set',
    label: 'Change facilitator controls',
    when: (editor) => {
      const s = getSession(editor);
      return !!s && canManage(editor, s);
    },
    run: (editor, args) => change(editor, patchFromArgs(args)),
  },
  {
    id: 'facilitation.end',
    icon: X,
    label: 'End facilitator controls',
    menus: ['board'],
    when: (editor) => {
      const s = getSession(editor);
      return !!s && canManage(editor, s);
    },
    disabledReason: 'Only the facilitator or the board owner can end it',
    run: (editor) => end(editor),
  },
  {
    id: 'facilitation.toggleCursors',
    icon: MousePointer2,
    label: "Hide other people's cursors",
    menus: ['board'],
    minRole: 'viewer',
    detail: () => (useCursorPrefs.getState().hideMine ? 'on' : 'off'),
    run: () => {
      const prefs = useCursorPrefs.getState();
      prefs.setHideMine(!prefs.hideMine);
    },
  },
]);
