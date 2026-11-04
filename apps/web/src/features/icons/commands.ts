import { defineCommands } from '@engine';
import { LIBRARY_PANEL } from './lib/insert';

import { t } from './messages';
export default defineCommands([
  {
    // How other features send people to the icon library (the shape library's wireframe set: icons
    // for screens). No menu of its own: the "+" tools entry is the way in.
    id: 'icons.openLibrary',
    label: t('openTheIconLibrary'),
    run(editor) {
      editor.openPanel(LIBRARY_PANEL);
    },
  },
]);
