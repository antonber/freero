import { EyeOff, Eye } from 'lucide-react';
import { defineCommands } from '@engine';
import { getSession, revealAndEnd, selectedFrame, start } from './lib/session';

export default defineCommands([
  {
    id: 'private-mode.start',
    icon: EyeOff,
    label: 'Start private mode',
    menus: ['board'],
    when: (editor) => !getSession(editor),
    run: (editor) => start(editor, null),
  },
  {
    id: 'private-mode.startInFrame',
    icon: EyeOff,
    label: 'Start private mode in this frame',
    menus: ['context'],
    when: (editor) => !getSession(editor) && !!selectedFrame(editor),
    run: (editor) => start(editor, selectedFrame(editor)?.id ?? null),
  },
  {
    // Board-menu escape hatch: any editor can reveal if the facilitator left.
    id: 'private-mode.reveal',
    icon: Eye,
    label: 'Reveal private content and end private mode',
    menus: ['board'],
    when: (editor) => !!getSession(editor),
    run: (editor) => revealAndEnd(editor),
  },
]);
