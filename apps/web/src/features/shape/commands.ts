import { LibraryBig } from 'lucide-react';
import { defineCommands } from '@engine';
import { armShape } from './lib/actions';
import { LIBRARY_PANEL_ID } from './lib/constants';

// Quick keys: jump straight to a specific shape (the Shapes tool remembers it afterwards).
export default defineCommands([
  {
    id: 'shape.rectangle',
    label: 'Rectangle',
    shortcut: 'r',
    run: (editor) => armShape(editor, 'rect'),
  },
  {
    id: 'shape.ellipse',
    label: 'Circle',
    shortcut: 'o',
    run: (editor) => armShape(editor, 'ellipse'),
  },
  {
    id: 'shape.openLibrary',
    label: 'Shape library',
    icon: LibraryBig,
    menus: ['board'],
    minRole: 'viewer',
    run: (editor) => editor.openDock(LIBRARY_PANEL_ID),
  },
]);
