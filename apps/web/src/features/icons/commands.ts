import { defineCommands } from '@engine';
import { LIBRARY_PANEL } from './lib/insert';

import { t } from './messages';
export default defineCommands([
  {
    // How other features send people to the icon library (the shape library's wireframe set: icons
    // for screens; its workspace packs, #4). No menu of its own: the "+" tools entry is the way in.
    // Args: { pack?: a shape pack's id to show, query?: what to search for }.
    id: 'icons.openLibrary',
    label: t('openTheIconLibrary'),
    run(editor, args) {
      const pack = typeof args?.pack === 'string' ? args.pack : undefined;
      const query = typeof args?.query === 'string' ? args.query : undefined;
      editor.openPanel(LIBRARY_PANEL, { ...(pack ? { pack } : {}), ...(query ? { query } : {}) });
    },
  },
]);
