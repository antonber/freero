import { Link2, Link2Off, SquareArrowOutUpRight } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { followLink } from './lib/follow';
import { LINK_DIALOG } from './lib/link';

/** The one selected, linkable item (connectors don't carry links), or null. */
const single = (editor: Editor) => {
  const sel = editor.getSelection();
  if (sel.length !== 1) return null;
  const el = editor.getElement(sel[0]);
  return el && el.type !== 'connector' ? el : null;
};

export default defineCommands([
  {
    id: 'links.edit',
    icon: Link2,
    label: 'Link to…',
    shortcut: 'mod+k',
    menus: ['context'],
    when: (editor) => !!single(editor) && !single(editor)!.locked,
    run(editor) {
      editor.openPanel(LINK_DIALOG, { id: single(editor)!.id });
    },
  },
  {
    id: 'links.open',
    icon: SquareArrowOutUpRight,
    label: 'Open link',
    minRole: 'viewer',
    menus: ['context'],
    when: (editor) => !!single(editor)?.link,
    run(editor) {
      followLink(editor, single(editor)!.link);
    },
  },
  {
    id: 'links.remove',
    icon: Link2Off,
    label: 'Remove link',
    menus: ['context'],
    when: (editor) => editor.getSelection().some((id) => !!editor.getElement(id)?.link && !editor.getElement(id)?.locked),
    run(editor) {
      const ids = editor.getSelection().filter((id) => editor.getElement(id)?.link && !editor.getElement(id)?.locked);
      editor.updateMany(ids.map((id) => ({ id, patch: { link: null } })));
    },
  },
]);
