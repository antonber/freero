import type { BoardElement } from '@freero/shared';
import { defineCommands, type CommandDefinition, type Editor, type NewElement, type Rect } from '@engine';
import { canCarryStamp, reactionSize, reactionSlot } from './lib/reactions';
import { STAMP_PREFIX, STAMPS, stampIcon } from './lib/stamps';

/** Elements a reaction can be attached to: the selection minus stamps/emoji themselves. */
function reactable(editor: Editor): BoardElement[] {
  return editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is BoardElement => !!el && canCarryStamp(editor, el));
}

/**
 * Stamps `emoji` on the top-right corner of every selected element, attached to it (it moves,
 * duplicates and is deleted with it). One command = one undo step.
 */
function react(editor: Editor, emoji: string) {
  const taken: Rect[] = editor
    .getElements()
    .filter((el) => el.type === 'emoji')
    .map(({ x, y, w, h }) => ({ x, y, w, h }));
  const stamps: NewElement<'emoji'>[] = [];
  for (const el of reactable(editor)) {
    const bounds = editor.getBounds([el.id]);
    if (!bounds) continue;
    const size = reactionSize(bounds);
    const at = reactionSlot(bounds, size, taken);
    stamps.push({ type: 'emoji', emoji, x: at.x, y: at.y, w: size, h: size, frameId: el.frameId ?? null, attachedTo: el.id });
  }
  editor.createMany(stamps as NewElement[]);
}

// Right-click → "React with ▸" → one entry per stamp.
export default defineCommands(
  STAMPS.map((stamp): CommandDefinition => ({
    id: `emoji.react.${stamp.id}`,
    label: stamp.label,
    group: 'React with',
    icon: stampIcon(stamp),
    menus: ['context'],
    when: (editor) => reactable(editor).length > 0,
    run: (editor) => react(editor, `${STAMP_PREFIX}${stamp.id}`),
  })),
);
