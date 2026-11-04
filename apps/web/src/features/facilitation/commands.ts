import { MousePointer2, Presentation, UsersRound, X } from 'lucide-react';
import { defineCommands } from '@engine';
import { canManage, canSetParticipation, change, end, getSession, isParticipationOpen, patchFromArgs, setParticipation, start, useCursorPrefs } from './lib/session';

import { t } from './messages';
export default defineCommands([
  {
    id: 'facilitation.start',
    icon: Presentation,
    label: t('facilitateThisSession'),
    menus: ['board'],
    when: (editor) => !getSession(editor),
    disabledReason: t('someoneIsAlreadyFacilitating'),
    // Args (other features, e.g. a retro): the controls to start with ({ locked, allowedTypes, follow, cursorsHidden }).
    run: (editor, args) => start(editor, patchFromArgs(args)),
  },
  {
    // For other features driving a session they started (no menus: not a user-facing action).
    id: 'facilitation.set',
    label: t('changeFacilitatorControls'),
    when: (editor) => {
      const s = getSession(editor);
      return !!s && canManage(editor, s);
    },
    run: (editor, args) => change(editor, patchFromArgs(args)),
  },
  {
    id: 'facilitation.end',
    icon: X,
    label: t('endFacilitatorControls'),
    menus: ['board'],
    when: (editor) => {
      const s = getSession(editor);
      return !!s && canManage(editor, s);
    },
    disabledReason: t('onlyTheFacilitatorOrThe'),
    run: (editor) => end(editor),
  },
  {
    // Parity rank 1: commenters and guests vote, estimate and write private drafts (their own only).
    id: 'facilitation.toggleParticipation',
    icon: UsersRound,
    label: t('commentersAndGuestsTakePart'),
    menus: ['board'],
    detail: (editor) => (isParticipationOpen(editor) ? 'on' : 'off'),
    when: (editor) => canSetParticipation(editor),
    disabledReason: t('onlyTheFacilitatorOrThe2'),
    // Args (other features): { open: boolean }.
    run: (editor, args) => setParticipation(editor, typeof args?.open === 'boolean' ? args.open : !isParticipationOpen(editor)),
  },
  {
    id: 'facilitation.toggleCursors',
    icon: MousePointer2,
    label: t('hideOtherPeopleSCursors'),
    menus: ['board'],
    minRole: 'viewer',
    detail: () => (useCursorPrefs.getState().hideMine ? 'on' : 'off'),
    run: () => {
      const prefs = useCursorPrefs.getState();
      prefs.setHideMine(!prefs.hideMine);
    },
  },
]);
