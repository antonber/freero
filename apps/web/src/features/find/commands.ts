import { Search } from 'lucide-react';
import { defineCommands } from '@engine';
import { PANEL_ID } from './lib/search';
import { setFindUi } from './lib/state';

export default defineCommands([
  {
    // Ctrl/⌘+F opens find (also mid-edit) instead of the browser's page search, which can't see
    // the canvas. Pressed again, it puts the cursor back in the search box.
    id: 'find.open',
    label: 'Find on board',
    icon: Search,
    shortcut: 'mod+f',
    minRole: 'viewer',
    menus: ['board'],
    run(editor) {
      if (editor.getEditingId()) editor.stopEditing();
      editor.openPanel(PANEL_ID);
      setFindUi(editor, (s) => ({ focusNonce: s.focusNonce + 1 }));
    },
  },
]);
