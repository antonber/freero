import { FileInput } from 'lucide-react';
import { defineCommands } from '@engine';
import { IMPORT_DIALOG } from './lib/insert';

export default defineCommands([
  {
    id: 'import.file',
    icon: FileInput,
    label: 'Import draw.io or Excalidraw file…',
    menus: ['board'],
    run(editor) {
      editor.openPanel(IMPORT_DIALOG);
    },
  },
]);
