import type { BoardElement } from '@freero/shared';
import { defineCommands, type Editor, type NewElement, type Rect } from '@engine';
import { DEFAULT_CHOICE, TOOL_ID, type EmojiToolOptions } from './lib/constants';
import { reactionSize, reactionSlot } from './lib/reactions';

/** Elements a reaction can be attached to: the selection minus stamps/emoji themselves. */
function reactable(editor: Editor): BoardElement[] {
  return editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is BoardElement => !!el && el.type !== 'emoji' && el.type !== 'connector');
}

export default defineCommands([
  {
    // Stamps the last emoji/stamp picked in the emoji tool (default "+1") on the top-right corner
    // of every selected element. One command = one undo step.
    id: 'emoji.react',
    label: 'React with stamp',
    menus: ['context'],
    when: (editor) => reactable(editor).length > 0,
    run(editor) {
      const targets = reactable(editor);
      const { current = DEFAULT_CHOICE } = editor.getToolOptions<EmojiToolOptions>(TOOL_ID);
      const taken: Rect[] = editor
        .getElements()
        .filter((el) => el.type === 'emoji')
        .map(({ x, y, w, h }) => ({ x, y, w, h }));
      const stamps: NewElement<'emoji'>[] = [];
      for (const el of targets) {
        const bounds = editor.getBounds([el.id]);
        if (!bounds) continue;
        const size = reactionSize(bounds);
        const at = reactionSlot(bounds, size, taken);
        stamps.push({ type: 'emoji', emoji: current, x: at.x, y: at.y, w: size, h: size, frameId: el.frameId ?? null });
      }
      editor.createMany(stamps as NewElement[]);
    },
  },
]);
