import { ListFilter, Palette, Shapes, Tag } from 'lucide-react';
import type { BoardElement } from '@freero/shared';
import { defineCommands, type CommandDefinition, type Editor } from '@engine';
import { colourOf, similarIds, tagsOf, type Similarity } from './lib/similar';
import { canNarrow, narrowableTypes, narrowTo } from './lib/narrow';

const selected = (editor: Editor) =>
  editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is BoardElement => !!el);

const command = (by: Similarity, label: string, icon: CommandDefinition['icon'], when: (els: BoardElement[]) => boolean, why: string): CommandDefinition => ({
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
  disabledReason: why,
  run(editor) {
    const ids = similarIds(editor.getElements(), selected(editor), by);
    editor.select(ids);
    if (ids.length > 1) editor.host.notify(`${ids.length} items selected`, 'info');
  },
});

// Right-click a mixed selection → "Select only ▸ Sticky notes (12) / Shapes (8)…": one entry per
// element type the board knows, named by its own feature.
const narrowCommand = ({ type, name }: { type: BoardElement['type']; name: string }): CommandDefinition => ({
  id: `select-similar.only.${type}`,
  label: name,
  icon: ListFilter,
  minRole: 'viewer',
  menus: ['context'],
  group: 'Select only',
  when: (editor) => canNarrow(selected(editor), type),
  disabledReason: (editor) =>
    selected(editor).some((el) => el.type === type) ? 'Only one kind of item is selected' : `No ${name.toLowerCase()} in the selection`,
  detail: (editor) => String(narrowTo(selected(editor), type).length),
  run: (editor) => editor.select(narrowTo(selected(editor), type)),
});

export default defineCommands(({ elements }) => [
  command('type', 'Of this type', Shapes, () => true, 'Select something first'),
  command('colour', 'With this colour', Palette, (els) => els.some((el) => colourOf(el) !== null), 'Select something with a colour'),
  command('tag', 'With this tag', Tag, (els) => els.some((el) => tagsOf(el).length > 0), 'Select something tagged'),
  ...narrowableTypes(elements).map(narrowCommand),
]);
