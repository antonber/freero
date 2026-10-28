import { History, X } from 'lucide-react';
import { defineCommands } from '@engine';
import { end, getSession, START_DIALOG_ID } from './lib/flow';

export default defineCommands([
  {
    id: 'retro.start',
    icon: History,
    label: 'Run a retrospective…',
    menus: ['board'],
    when: (editor) => !getSession(editor),
    disabledReason: 'A retrospective is already running',
    run: (editor) => editor.openPanel(START_DIALOG_ID),
  },
  {
    // Board-menu escape hatch: any editor can close a retro whose facilitator left.
    id: 'retro.end',
    icon: X,
    label: 'End the retrospective',
    menus: ['board'],
    when: (editor) => !!getSession(editor),
    run: (editor) => end(editor),
  },
]);
