import { defineCommands } from '@engine';
import { LIBRARY_PANEL } from './lib/insert';

export default defineCommands([
  {
    // How other features send people to the icon library (the shape library's wireframe set: icons
    // for screens). No menu of its own: the "+" tools entry is the way in.
    id: 'icons.openLibrary',
    label: 'Open the icon library',
    run(editor) {
      editor.openPanel(LIBRARY_PANEL);
    },
  },
]);
