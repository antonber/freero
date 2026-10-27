import { memo } from 'react';
import { STICKY_COLORS, type StickyElement } from '@freero/shared';
import {
  defineElement,
  ElementText,
  plainToRichText,
  richTextToPlain,
  type ElementRenderProps,
  type NewElement,
} from '@engine';
import { STICKY_GAP, STICKY_SIZE } from './lib/constants';
import { stickyAt } from './lib/actions';
import { gridPositions } from './lib/layout';
import './sticky.css';

/** Below this zoom the text is unreadable anyway: draw cheap "text lines" instead (2000-sticky boards). */
const LOD_ZOOM = 0.18;

/**
 * Tagged stickies keep a bottom band free for the tag chips the tags feature draws there
 * (8 px margin + 18 px chip + 4 px gap, scaled with the sticky like the chips).
 */
function tagBand(el: StickyElement): number {
  if (!el.tags?.length) return 0;
  return 30 * Math.min(2.5, Math.max(0.5, Math.min(el.w, el.h) / 200));
}
const MAX_IMPORTED = 60;

const StickyView = memo(function StickyView({ element, zoom }: ElementRenderProps<StickyElement>) {
  const bg = STICKY_COLORS[element.color] ?? STICKY_COLORS.yellow;
  const pad = Math.max(8, Math.min(element.w, element.h) * 0.08);
  const lod = zoom < LOD_ZOOM;
  return (
    <div className="fr-sticky" style={{ background: bg }}>
      {lod ? (
        element.text && (
          <div className="fr-sticky__lines" aria-hidden>
            <span />
            <span />
            <span />
          </div>
        )
      ) : (
        <ElementText
          element={element}
          field="text"
          padding={{ top: pad, right: pad, bottom: Math.max(pad, tagBand(element)), left: pad }}
          placeholder=""
        />
      )}
    </div>
  );
});

export default defineElement({
  type: 'sticky',
  resize: 'free',
  minSize: { w: 48, h: 48 },
  textField: 'text',
  defaults: (): Omit<NewElement<'sticky'>, 'x' | 'y'> => ({
    type: 'sticky',
    w: STICKY_SIZE,
    h: STICKY_SIZE,
    color: 'yellow',
    text: '',
    fontFamily: 'sans',
    fontSize: 'auto',
    textColor: '#17162B',
    align: 'center',
    vAlign: 'middle',
  }),
  Component: StickyView,
  toPlainText: (el) => richTextToPlain(el.text),
  // Plain text claims last (low priority): richer importers (images, text boxes) win.
  importPriority: -10,
  importData(editor, data, at) {
    const text = data.text?.trim();
    if (!text || data.files.length) return false;
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, MAX_IMPORTED);
    // Short multi-line lists become one sticky per line; prose stays in one sticky.
    const asList = lines.length > 1 && lines.every((l) => l.length <= 140);
    const items = asList ? lines : [text];
    const positions = gridPositions(items.length, STICKY_SIZE, STICKY_GAP, at);
    editor.createMany(
      items.map((t, i) =>
        stickyAt(editor, { x: positions[i].x + STICKY_SIZE / 2, y: positions[i].y + STICKY_SIZE / 2 }, { text: plainToRichText(t) }),
      ),
      { select: true },
    );
    return true;
  },
});
