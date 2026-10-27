import { MonitorPlay, X } from 'lucide-react';
import { defineCommands } from '@engine';
import { presentStore, startPresenting, stopPresenting } from './lib/session';

export default defineCommands([
  {
    id: 'present.start',
    icon: MonitorPlay,
    label: 'Present',
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => !presentStore(editor).getState().presenting,
    run: (editor) => startPresenting(editor),
  },
  {
    id: 'present.stop',
    icon: X,
    label: 'Exit presentation',
    minRole: 'viewer',
    when: (editor) => presentStore(editor).getState().presenting,
    run: stopPresenting,
  },
]);
