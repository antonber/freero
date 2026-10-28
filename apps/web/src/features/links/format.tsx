import { Link2 } from 'lucide-react';
import { defineFormat } from '@engine';
import { IconButton } from '@ui';
import { LINK_DIALOG } from './lib/link';

/** "Link" in the format toolbar of any single unlocked item (connectors excepted). */
export default defineFormat({
  id: 'links.format',
  order: 900,
  appliesTo: (selection) => selection.length === 1 && selection[0].type !== 'connector' && !selection[0].locked,
  Component: ({ editor, selection }) => (
    <IconButton
      icon={Link2}
      label={selection[0].link ? 'Edit link' : 'Link to…'}
      shortcut="Mod+K"
      size={32}
      active={!!selection[0].link}
      onClick={() => editor.openPanel(LINK_DIALOG, { id: selection[0].id })}
    />
  ),
});
