import { EyeOff, Eye } from 'lucide-react';
import { defineCommands } from '@engine';
import { getSession, revealAndEnd, selectedFrame, start } from './lib/session';

import { t } from './messages';
export default defineCommands([
  {
    id: 'private-mode.start',
    icon: EyeOff,
    label: t('startPrivateMode'),
    menus: ['board'],
    when: (editor) => !getSession(editor),
    // args { anonymous: true } (e.g. a retro): drafts are revealed without names (#44).
    run: (editor, args) => start(editor, null, { anonymous: args?.anonymous === true }),
  },
  {
    id: 'private-mode.startInFrame',
    icon: EyeOff,
    label: t('startPrivateModeInThis'),
    menus: ['context'],
    when: (editor) => !getSession(editor) && !!selectedFrame(editor),
    run: (editor) => start(editor, selectedFrame(editor)?.id ?? null),
  },
  {
    // Board-menu escape hatch: any editor can reveal if the facilitator left.
    id: 'private-mode.reveal',
    icon: Eye,
    label: t('revealPrivateContentAndEnd'),
    menus: ['board'],
    when: (editor) => !!getSession(editor),
    // args { id } (a retro): reveals and ends only that session.
    run: (editor, args) => revealAndEnd(editor, typeof args?.id === 'string' ? args.id : undefined),
  },
]);
