import { defineCommands } from '@engine';
import { presentStore, startPresenting, stopPresenting } from './lib/session';

export default defineCommands([
  {
    id: 'present.start',
    label: 'Present',
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => !presentStore(editor).getState().presenting,
    run: (editor) => startPresenting(editor),
  },
  {
    id: 'present.stop',
    label: 'Exit presentation',
    minRole: 'viewer',
    when: (editor) => presentStore(editor).getState().presenting,
    run: stopPresenting,
  },
]);
