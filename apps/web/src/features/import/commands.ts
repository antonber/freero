import { FileInput } from 'lucide-react';
import { defineCommands } from '@engine';
import { IMPORT_DIALOG } from './lib/insert';

import { t } from './messages';
export default defineCommands([
  {
    id: 'import.file',
    icon: FileInput,
    label: t('importDrawIoExcalidrawVisio'),
    menus: ['board'],
    run(editor) {
      editor.openPanel(IMPORT_DIALOG);
    },
  },
]);
