// The image toolbar's "Refresh from Figma" for frames placed from Figma (or sent by the plugin).
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { defineFormat } from '@engine';
import { IconButton } from '@ui';
import { figmaImage, refreshFromFigma } from './lib/frames';
import { t } from './messages';

export default defineFormat({
  id: 'figma.format',
  order: 46,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => !!figmaImage(el) && !el.locked),
  Component: ({ editor, selection }) => {
    const [busy, setBusy] = useState(false);
    if (!editor.host.figma || !editor.can('editor')) return null;
    return (
      <IconButton
        icon={RefreshCw}
        size={32}
        label={busy ? t('refreshing') : t('refreshFromFigma')}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void refreshFromFigma(
            editor,
            selection.map((el) => el.id),
          ).finally(() => setBusy(false));
        }}
      />
    );
  },
});
