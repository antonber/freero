import { Frame, RefreshCw } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { DIALOG, figmaImage, refreshFromFigma } from './lib/frames';
import { t } from './messages';

const selectedFigmaImages = (editor: Editor) =>
  editor
    .getSelection()
    .map((id) => figmaImage(editor.getElement(id)))
    .filter((el) => !!el && !el.locked);

export default defineCommands([
  {
    id: 'figma.place',
    icon: Frame,
    label: t('placeFromFigma'),
    menus: ['board'],
    minRole: 'editor',
    when: (editor) => !!editor.host.figma && editor.can('editor'),
    disabledReason: (editor) => (editor.host.figma ? t('youNeedEditAccess') : t('notOfferedHere')),
    // Figma's consent sends the person back with ?figma=connected (or figma_error=…): the picker reopens.
    urlParam: 'figma',
    run(editor, args) {
      if (!editor.host.figma) return;
      const query = (args as { query?: Record<string, string> } | undefined)?.query;
      if (query?.figma_error) editor.host.notify(query.figma_error === 'cancelled' ? t('connectCancelled') : t('connectFailed'), 'error');
      editor.openPanel(DIALOG);
    },
  },
  {
    id: 'figma.refresh',
    icon: RefreshCw,
    label: t('refreshFromFigma'),
    menus: ['context'],
    minRole: 'editor',
    when: (editor) => !!editor.host.figma && selectedFigmaImages(editor).length > 0,
    run(editor) {
      void refreshFromFigma(editor, editor.getSelection());
    },
  },
]);
