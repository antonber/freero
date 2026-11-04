import { ListFilter, Palette, Shapes, Tag } from 'lucide-react';
import type { BoardElement } from '@freero/shared';
import { defineCommands, type CommandDefinition, type Editor } from '@engine';
import { colourOf, similarIds, tagsOf, type Similarity } from './lib/similar';
import { canNarrow, narrowableTypes, narrowTo } from './lib/narrow';

import { t } from './messages';
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
  group: t('selectAll'),
  when: (editor) => {
    const els = selected(editor);
    return els.length > 0 && when(els);
  },
  disabledReason: why,
  run(editor) {
    const ids = similarIds(editor.getElements(), selected(editor), by);
    editor.select(ids);
    if (ids.length > 1) editor.host.notify(t('lengthItemsSelected', { length: ids.length }), 'info');
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
  group: t('selectOnly'),
  when: (editor) => canNarrow(selected(editor), type),
  disabledReason: (editor) =>
    selected(editor).some((el) => el.type === type) ? t('onlyOneKindOfItem') : t('noNameInTheSelection', { name: name.toLowerCase() }),
  detail: (editor) => String(narrowTo(selected(editor), type).length),
  run: (editor) => editor.select(narrowTo(selected(editor), type)),
});

export default defineCommands(({ elements }) => [
  command('type', t('ofThisType'), Shapes, () => true, t('selectSomethingFirst')),
  command('colour', t('withThisColour'), Palette, (els) => els.some((el) => colourOf(el) !== null), t('selectSomethingWithAColour')),
  command('tag', t('withThisTag'), Tag, (els) => els.some((el) => tagsOf(el).length > 0), t('selectSomethingTagged')),
  ...narrowableTypes(elements).map(narrowCommand),
]);
