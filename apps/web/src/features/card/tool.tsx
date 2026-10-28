import { ListTodo } from 'lucide-react';
import { defineTool, useToolGhost, useToolOptions } from '@engine';
import { ColorSwatches } from '@ui';
import { ACCENTS, ACCENT_NAMES, DEFAULT_ACCENT, TOOL_ID, type CardToolOptions } from './lib/constants';
import { CARD_W, cardLayout } from './lib/layout';
import { cardAt } from './lib/actions';

const GHOST_H = cardLayout({ w: CARD_W, title: '', description: '' }).h;

export default defineTool({
  id: TOOL_ID,
  label: 'Card',
  icon: ListTodo,
  order: 40,
  placement: 'more',
  cursor: 'crosshair',

  // Click places a card centered on the cursor and starts typing its title (one gesture).
  onPointerDown({ editor, point, button }) {
    if (button !== 0) return;
    const id = editor.create(cardAt(editor, point), { select: true });
    editor.setTool('select');
    if (id) editor.startEditing(id);
  },

  Options: ({ editor }) => {
    const { color = DEFAULT_ACCENT } = useToolOptions<CardToolOptions>(TOOL_ID);
    return (
      <div className="fr-card-pop">
        <div className="fr-card-pop__label">Card color</div>
        <ColorSwatches
          colors={ACCENTS}
          names={ACCENT_NAMES}
          value={color}
          onChange={(c) => editor.setToolOptions(TOOL_ID, { color: c })}
          columns={4}
          size={24}
          aria-label="Card color"
        />
      </div>
    );
  },

  Preview: () => {
    const p = useToolGhost({ w: CARD_W, h: GHOST_H });
    const { color = DEFAULT_ACCENT } = useToolOptions<CardToolOptions>(TOOL_ID);
    if (!p) return null;
    return (
      <div
        className="fr-card-ghost"
        style={{
          width: CARD_W,
          height: GHOST_H,
          ['--accent' as string]: color,
          transform: `translate(${p.x}px, ${p.y}px)`,
        }}
      />
    );
  },
});
