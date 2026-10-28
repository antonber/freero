import { memo } from 'react';
import type { EmojiElement } from '@freero/shared';
import { defineElement, type ElementRenderProps, type NewElement } from '@engine';
import { Glyph } from './lib/Glyph';
import { DEFAULT_CHOICE, PLACE_SIZE } from './lib/constants';
import { stampOf } from './lib/stamps';
import { stampTargetAt } from './lib/reactions';
import './emoji.css';

const EmojiView = memo(function EmojiView({ element }: ElementRenderProps<EmojiElement>) {
  return (
    <div className={`fr-emoji${stampOf(element.emoji) ? ' fr-emoji--stamp' : ''}`}>
      <Glyph value={element.emoji} />
    </div>
  );
});

export default defineElement({
  type: 'emoji',
  resize: 'aspect',
  minSize: { w: 16, h: 16 },
  connectable: false,
  defaults: (): Omit<NewElement<'emoji'>, 'x' | 'y'> => ({
    type: 'emoji',
    w: PLACE_SIZE,
    h: PLACE_SIZE,
    emoji: DEFAULT_CHOICE,
  }),
  Component: EmojiView,
  // A stamp moved on its own (not riding along with its item) re-attaches to whatever it was
  // dropped on, or detaches on empty canvas. In the move's own transaction and undo step.
  follow(el, { editor, changed }) {
    if (!changed.has(el.id) || (el.attachedTo && changed.has(el.attachedTo))) return null;
    const on = stampTargetAt(editor, { x: el.x + el.w / 2, y: el.y + el.h / 2 }, el.id);
    return (on?.id ?? null) !== (el.attachedTo ?? null) ? { attachedTo: on?.id ?? null } : null;
  },
  toPlainText: (el) => stampOf(el.emoji)?.label ?? el.emoji,
});
