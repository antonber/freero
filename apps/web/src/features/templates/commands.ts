import { LayoutTemplate } from 'lucide-react';
import { defineCommands } from '@engine';
import { DOCK_ID } from './lib/insert';

export default defineCommands([
  {
    id: 'templates.open',
    icon: LayoutTemplate,
    label: 'Templates…',
    menus: ['board'],
    run(editor) {
      editor.openDock(editor.getDock() === DOCK_ID ? null : DOCK_ID);
    },
  },
]);
