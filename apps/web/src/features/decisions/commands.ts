import { Stamp } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { CREATE_ID, LIST_ID } from './lib/ids';

import { t } from './messages';
/** The one frame selected, if that is the selection. */
const selectedFrame = (editor: Editor) => {
  const ids = editor.getSelection();
  const el = ids.length === 1 ? editor.getElement(ids[0]) : undefined;
  return el?.type === 'frame' ? el : null;
};

export default defineCommands([
  {
    id: 'decisions.freezeBoard',
    label: t('freezeForADecision'),
    icon: Stamp,
    menus: ['board'],
    minRole: 'editor',
    when: (editor) => !!editor.host.decisions,
    run: (editor) => editor.openPanel(CREATE_ID, {}),
  },
  {
    id: 'decisions.freezeFrame',
    label: t('freezeThisFrameForA'),
    icon: Stamp,
    menus: ['context'],
    minRole: 'editor',
    when: (editor) => !!editor.host.decisions && selectedFrame(editor) !== null,
    disabledReason: t('selectOneFrame'),
    run(editor) {
      const frame = selectedFrame(editor);
      if (frame) editor.openPanel(CREATE_ID, { frameId: frame.id });
    },
  },
  {
    id: 'decisions.list',
    label: t('decisions'),
    icon: Stamp,
    menus: ['board'],
    minRole: 'viewer',
    when: (editor) => !!editor.host.decisions,
    run: (editor) => editor.openDock(editor.getDock() === LIST_ID ? null : LIST_ID),
  },
]);
