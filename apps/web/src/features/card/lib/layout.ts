// Card geometry: the height is derived from the content (title wrap, description preview,
// footer), so `normalize` can keep it right after every edit. Text is measured with the engine's
// measureRichText, i.e. exactly as ElementText lays the title out.
import type { CardElement } from '@freero/shared';
import { measureRichText, plainToRichText, richTextToPlain } from '@engine';

export const CARD_W = 300;
export const CARD_MIN_W = 200;
export const PAD = { left: 22, right: 14, top: 13, bottom: 12 };
export const TITLE = { size: 15, weight: 600, line: 20 };
export const DESC = { size: 13, weight: 400, line: 18, maxLines: 3, gap: 4 };
export const FOOTER = { h: 24, gap: 10 };

/** Rendered line count of `html` in a column `width` px wide. */
function lineCount(html: string, t: { size: number; weight: number; line: number }, width: number): number {
  return measureRichText(html, { fontSize: t.size, fontWeight: t.weight, lineHeight: t.line / t.size, width, whiteSpace: 'pre-wrap' }).lines;
}

export interface CardLayout {
  titleLines: number;
  descLines: number;
  descText: string;
  h: number;
}

export function cardLayout(el: Pick<CardElement, 'w' | 'title' | 'description'>): CardLayout {
  const inner = Math.max(40, el.w - PAD.left - PAD.right);
  const titleLines = lineCount(el.title ?? '', TITLE, inner);
  const descText = richTextToPlain(el.description ?? '').trim();
  const descLines = descText ? Math.min(DESC.maxLines, lineCount(plainToRichText(descText), DESC, inner)) : 0;
  const h =
    PAD.top +
    titleLines * TITLE.line +
    (descLines ? DESC.gap + descLines * DESC.line : 0) +
    FOOTER.gap +
    FOOTER.h +
    PAD.bottom;
  return { titleLines, descLines, descText, h };
}
