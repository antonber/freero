import { MousePointer2, Presentation, UsersRound, X } from 'lucide-react';
import { defineCommands } from '@engine';
import { canManage, canSetParticipation, change, end, getSession, isParticipationOpen, patchFromArgs, setParticipation, start, useCursorPrefs } from './lib/session';

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
    // Parity rank 1: commenters and guests vote, estimate and write private drafts (their own only).
    id: 'facilitation.toggleParticipation',
    icon: UsersRound,
    label: 'Commenters and guests take part',
    menus: ['board'],
    detail: (editor) => (isParticipationOpen(editor) ? 'on' : 'off'),
    when: (editor) => canSetParticipation(editor),
    disabledReason: 'Only the facilitator or the board owner can change it',
    // Args (other features): { open: boolean }.
    run: (editor, args) => setParticipation(editor, typeof args?.open === 'boolean' ? args.open : !isParticipationOpen(editor)),
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
