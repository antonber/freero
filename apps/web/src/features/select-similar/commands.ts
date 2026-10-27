import { Palette, Shapes, Tag } from 'lucide-react';
import type { BoardElement } from '@freero/shared';
import { defineCommands, type CommandDefinition, type Editor } from '@engine';
import { colourOf, similarIds, tagsOf, type Similarity } from './lib/similar';

const selected = (editor: Editor) =>
  editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is BoardElement => !!el);

const command = (by: Similarity, label: string, icon: CommandDefinition['icon'], when: (els: BoardElement[]) => boolean): CommandDefinition => ({
  id: `select-similar.${by}`,
  label,
  icon,
  minRole: 'viewer',
  menus: ['context'],
  group: 'Select all',
  when: (editor) => {
    const els = selected(editor);
    return els.length > 0 && when(els);
  },
  run(editor) {
    const ids = similarIds(editor.getElements(), selected(editor), by);
    editor.select(ids);
    if (ids.length > 1) editor.host.notify(`${ids.length} items selected`, 'info');
  },
});

export default defineCommands([
  command('type', 'Of this type', Shapes, () => true),
  command('colour', 'With this colour', Palette, (els) => els.some((el) => colourOf(el) !== null)),
  command('tag', 'With this tag', Tag, (els) => els.some((el) => tagsOf(el).length > 0)),
]);
