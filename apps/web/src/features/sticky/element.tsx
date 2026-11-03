import { StickyNote as StickyNoteIcon } from 'lucide-react';
import { memo } from 'react';
import { STICKY_COLORS, STICKY_INK, stickyInk, type StickyElement } from '@freero/shared';
import {
  defineElement,
  ElementText,
  plainToRichText,
  richTextToPlain,
  type ElementRenderProps,
  type LowDetailPaint,
  type NewElement,
} from '@engine';
import { STICKY_GAP, STICKY_SIZE, TOOL_ID, nearestColor, toolDims, type StickyToolOptions } from './lib/constants';
import { stickyAt } from './lib/actions';
import { gridPositions } from './lib/layout';
import { listItems } from './lib/paste';
import './sticky.css';

/** Below this zoom the text is unreadable anyway: draw cheap "text lines" instead (2000-sticky boards). */
const LOD_ZOOM = 0.18;

const StickyView = memo(function StickyView({ element, zoom, reserved }: ElementRenderProps<StickyElement>) {
  const bg = STICKY_COLORS[element.color] ?? STICKY_COLORS.yellow;
  const pad = Math.max(8, Math.min(element.w, element.h) * 0.08);
  const lod = zoom < LOD_ZOOM;
  // Light ink on dark papers, decided here (never stored: see stickyInk).
  const ink = stickyInk(element.color);
  return (
    <div className={`fr-sticky${ink === STICKY_INK ? '' : ' fr-sticky--dark'}`} style={{ background: bg, color: ink }}>
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
          // Decorations drawn over the paper (tag chips) reserve their band; text stays clear of it.
          padding={{
            top: Math.max(pad, reserved?.top ?? 0),
            right: Math.max(pad, reserved?.right ?? 0),
            bottom: Math.max(pad, reserved?.bottom ?? 0),
            left: Math.max(pad, reserved?.left ?? 0),
          }}
          placeholder=""
          color={ink}
        />
      )}
    </div>
  );
});

/**
 * Zoomed out to low detail (#131): the paper, with three faint lines where it holds text (in its
 * ink, as the sticky's own far-away drawing has them). No shadow, no text layout.
 */
function paintSticky(el: StickyElement, p: LowDetailPaint) {
  p.box({ fill: STICKY_COLORS[el.color] ?? STICKY_COLORS.yellow, radius: 3 });
  if (!el.text) return;
  const ink = stickyInk(el.color);
  const alpha = ink === STICKY_INK ? 0.2 : 0.4;
  const h = el.h * 0.07;
  for (const [y, w] of [[0.34, 0.64], [0.5, 0.52], [0.66, 0.36]] as const) p.rect(el.w * (1 - w) / 2, el.h * y - h / 2, el.w * w, h, ink, alpha);
}

export default defineElement({
  type: 'sticky',
  label: { one: 'Sticky note', many: 'Sticky notes' },
  icon: StickyNoteIcon,
  resize: 'free',
  minSize: { w: 48, h: 48 },
  // Mixed selections: the paper is the fill (any colour lands on the nearest paper); no text
  // colour (sticky text keeps its readable ink).
  sharedStyle: (el) => ({ fill: STICKY_COLORS[el.color], fontFamily: el.fontFamily, fontSize: el.fontSize, align: el.align, vAlign: el.vAlign }),
  applySharedStyle: (_el, { fill, ...rest }) => ({ ...rest, ...(fill ? { color: nearestColor(fill) } : {}) }),
  // A few pixels big (a large board's thumbnail): its paper.
  swatch: (el) => STICKY_COLORS[el.color] ?? STICKY_COLORS.yellow,
  textField: 'text',
  defaults: (): Omit<NewElement<'sticky'>, 'x' | 'y'> => ({
    type: 'sticky',
    w: STICKY_SIZE,
    h: STICKY_SIZE,
    color: 'yellow',
    text: '',
    fontFamily: 'sans',
    fontSize: 'auto',
    textColor: STICKY_INK,
    align: 'center',
    vAlign: 'middle',
  }),
  Component: StickyView,
  lowDetail: paintSticky,
  toPlainText: (el) => richTextToPlain(el.text),
  // Lists become stickies; prose is left to the text box importer (priority 0). See lib/paste.ts.
  importPriority: 5,
  importData(editor, data, at) {
    const text = data.text?.trim();
    if (!text || data.files.length) return false;
    const selected = editor
      .getSelection()
      .map((id) => editor.getElement(id))
      .filter((el): el is StickyElement => el?.type === 'sticky');
    const items = listItems(text, data.html) ?? (selected.length ? [text] : null);
    if (!items) return false;
    // Pasting onto selected stickies keeps their color.
    const color = selected[0]?.color;
    // In the shape and size the sticky tool would place.
    const box = toolDims(editor.getToolOptions<StickyToolOptions>(TOOL_ID));
    const positions = gridPositions(items.length, box, STICKY_GAP, at);
    editor.createMany(
      items.map((t, i) =>
        stickyAt(editor, { x: positions[i].x + box.w / 2, y: positions[i].y + box.h / 2 }, {
          text: plainToRichText(t),
          ...(color ? { color } : {}),
        }),
      ),
      { select: true },
    );
    return true;
  },
});
