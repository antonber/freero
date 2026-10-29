// Slide layouts (KAI-126): Freero's own arrangements of editable text (and an image area) inside
// a slide frame, sized to the frame. Pure: frame rect in, element drafts out (frame-local values
// scale with the frame, so a 4:3 slide or a phone frame gets the same proportions).
import { plainToRichText } from '@freero/shared';
import type { NewElement, Rect } from '@engine';

export type SlideLayoutId = 'title' | 'title-body' | 'two-columns' | 'image-text';

export const SLIDE_LAYOUTS: Array<{ id: SlideLayoutId; label: string; hint: string }> = [
  { id: 'title', label: 'Title', hint: 'A big title and a subtitle' },
  { id: 'title-body', label: 'Title and body', hint: 'A heading over a list of points' },
  { id: 'two-columns', label: 'Two columns', hint: 'A heading over two side-by-side texts' },
  { id: 'image-text', label: 'Image and text', hint: 'An image area beside a text' },
];

const INK = '#17162B';
const MUTED = '#4B4A63';

type Draft = NewElement<'text'> | NewElement<'shape'>;

function text(x: number, y: number, w: number, h: number, content: string, size: number, opts: { align?: 'left' | 'center'; color?: string; bold?: boolean } = {}): NewElement<'text'> {
  const html = opts.bold ? `<b>${plainToRichText(content)}</b>` : content.split('\n').map((l) => `<p>${plainToRichText(l)}</p>`).join('');
  return {
    type: 'text',
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    text: html,
    fontFamily: 'sans',
    fontSize: Math.max(10, Math.round(size)),
    textColor: opts.color ?? INK,
    align: opts.align ?? 'left',
    background: 'transparent',
    autoWidth: false,
  } as NewElement<'text'>;
}

/**
 * The items a layout puts into a slide at `frame`: world coordinates, all inside the frame with
 * a margin (so the engine's membership rule puts them in it), `frameId` set.
 */
export function layoutItems(frame: Rect & { id: string }, layout: SlideLayoutId): Draft[] {
  // Everything scales from a 1280 × 720 design, by the frame's shorter side.
  const k = Math.min(frame.w / 1280, frame.h / 720);
  const m = Math.round(72 * k);
  const x0 = frame.x + m;
  const y0 = frame.y + m;
  const w = frame.w - m * 2;
  const h = frame.h - m * 2;
  const headH = 90 * k;
  const gap = 48 * k;
  const body = 'First point\nSecond point\nThird point';
  let items: Draft[];
  switch (layout) {
    case 'title':
      items = [
        text(x0, frame.y + frame.h * 0.34, w, 120 * k, 'Presentation title', 72 * k, { align: 'center', bold: true }),
        text(x0, frame.y + frame.h * 0.34 + 140 * k, w, 60 * k, 'Subtitle or presenter name', 32 * k, { align: 'center', color: MUTED }),
      ];
      break;
    case 'title-body':
      items = [text(x0, y0, w, headH, 'Slide title', 56 * k, { bold: true }), text(x0, y0 + headH + gap, w, h - headH - gap, body, 30 * k)];
      break;
    case 'two-columns': {
      const cw = (w - gap) / 2;
      items = [
        text(x0, y0, w, headH, 'Slide title', 56 * k, { bold: true }),
        text(x0, y0 + headH + gap, cw, h - headH - gap, body, 28 * k),
        text(x0 + cw + gap, y0 + headH + gap, cw, h - headH - gap, body, 28 * k),
      ];
      break;
    }
    case 'image-text': {
      const iw = (w - gap) * 0.55;
      const image: NewElement<'shape'> = {
        type: 'shape',
        shape: 'rect',
        x: Math.round(x0),
        y: Math.round(y0),
        w: Math.round(iw),
        h: Math.round(h),
        fill: '#EFEEF6',
        stroke: '#CFCDE0',
        strokeWidth: 2,
        strokeStyle: 'dashed',
        text: `<p>${plainToRichText('Image: paste or drop one here')}</p>`,
        fontSize: Math.max(12, Math.round(22 * k)),
        textColor: MUTED,
      } as unknown as NewElement<'shape'>;
      items = [image, text(x0 + iw + gap, y0, w - iw - gap, headH * 1.6, 'Slide title', 48 * k, { bold: true }), text(x0 + iw + gap, y0 + headH * 1.6 + gap / 2, w - iw - gap, h - headH * 1.6 - gap / 2, body, 26 * k)];
      break;
    }
  }
  return items.map((d) => ({ ...d, frameId: frame.id }));
}
