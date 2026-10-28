import { Activity } from 'lucide-react';
import { defineCommands } from '@engine';
import { PANEL_ID } from './lib/ids';

export default defineCommands([
  {
    id: 'activity.togglePanel',
    label: 'Activity',
    icon: Activity,
    menus: ['board'],
    // Everyone who can open the board sees what happened on it (the server leaves out what they
    // may not see: hidden frames' contents for viewers/commenters).
    minRole: 'viewer',
    when: (editor) => !!editor.host.activity,
    run: (editor) => editor.openDock(editor.getDock() === PANEL_ID ? null : PANEL_ID),
  },
]);
