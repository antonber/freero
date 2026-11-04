import { Maximize2, MessageSquareText, QrCode } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { ANSWER_DIALOG, LINK_DIALOG, STAGE_DIALOG } from './lib/activity';

import { t } from './messages';
const selectedActivity = (editor: Editor): string | null => {
  const sel = editor.getSelection();
  return sel.length === 1 && editor.getElement(sel[0])?.type === 'activity' ? sel[0] : null;
};

export default defineCommands([
  {
    // `/board/<id>?activity=<activityId>` (the copied answer link, a QR code on a slide): opens the
    // answer form straight away — on a phone too, where the board stays behind it.
    id: 'engage.answer',
    label: t('answerAnActivity'),
    minRole: 'viewer',
    urlParam: 'activity',
    run(editor, args) {
      const id = typeof args?.activity === 'string' ? args.activity : typeof args?.id === 'string' ? args.id : null;
      if (id && editor.getElement(id)?.type === 'activity') editor.openPanel(ANSWER_DIALOG, { id });
      else editor.host.notify(t('thatActivityIsNoLonger'), 'info');
    },
  },
  {
    id: 'engage.answerSelected',
    label: t('answerThisActivity'),
    icon: MessageSquareText,
    minRole: 'viewer',
    menus: ['context'],
    when: (editor) => selectedActivity(editor) !== null,
    run(editor) {
      const id = selectedActivity(editor);
      if (id) editor.openPanel(ANSWER_DIALOG, { id });
    },
  },
  {
    // The phone answer link as a QR code (#40), for anyone on the board.
    id: 'engage.showLink',
    label: t('answerLinkAndQrCode'),
    icon: QrCode,
    minRole: 'viewer',
    menus: ['context'],
    when: (editor) => selectedActivity(editor) !== null,
    run(editor) {
      const id = selectedActivity(editor);
      if (id) editor.openPanel(LINK_DIALOG, { id });
    },
  },
  {
    // Presenter view (#40): the activity full screen, results growing live.
    id: 'engage.stage',
    label: t('showActivityFullScreen'),
    icon: Maximize2,
    minRole: 'viewer',
    menus: ['context'],
    when: (editor) => selectedActivity(editor) !== null,
    run(editor, args) {
      const id = typeof args?.id === 'string' ? args.id : selectedActivity(editor);
      if (id && editor.getElement(id)?.type === 'activity') editor.openPanel(STAGE_DIALOG, { id });
    },
  },
]);
