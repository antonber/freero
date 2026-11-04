import { Paintbrush } from 'lucide-react';
import { defineFormat, useToolId } from '@engine';
import { IconButton } from '@ui';
import { pickUp, TOOL_ID } from './lib/style';

import { t } from './messages';
/** One item selected: the brush that picks up its style and arms the painter. */
export default defineFormat({
  id: 'format-painter.format',
  order: 95,
  appliesTo: (selection) => selection.length === 1,
  Component: ({ editor }) => {
    const active = useToolId() === TOOL_ID;
    return (
      <IconButton
        icon={Paintbrush}
        label={active ? t('stopPaintingFormat') : t('formatPainterClickOtherItems')}
        shortcut="Alt+Mod+C"
        size={32}
        active={active}
        onClick={() => {
          if (active) return editor.setTool('select');
          if (pickUp(editor)) editor.setTool(TOOL_ID);
        }}
      />
    );
  },
});
