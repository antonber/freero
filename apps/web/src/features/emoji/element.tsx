import { memo } from 'react';
import type { EmojiElement } from '@freero/shared';
import { defineElement, type ElementRenderProps, type NewElement } from '@engine';
import { Glyph } from './lib/Glyph';
import { DEFAULT_CHOICE, PLACE_SIZE } from './lib/constants';
import { stampOf } from './lib/stamps';
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
  toPlainText: (el) => stampOf(el.emoji)?.label ?? el.emoji,
});
