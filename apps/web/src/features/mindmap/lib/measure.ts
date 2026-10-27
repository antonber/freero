// Node sizing: a pill hugging its text, measured by the engine exactly as ElementText renders it
// (used by `normalize`, the tool's ghost and new-node planning).
import { measureRichText } from '@engine';

export const NODE_STYLE = {
  root: { font: 20, weight: 700, padX: 26, padY: 14, minW: 150, maxText: 300 },
  node: { font: 15, weight: 500, padX: 16, padY: 8, minW: 64, maxText: 260 },
} as const;

/** Box of a node whose RichText is `html`: text wraps past `maxText`, then the pill's padding. */
export function nodeSize(html: string, isRoot: boolean): { w: number; h: number } {
  const s = isRoot ? NODE_STYLE.root : NODE_STYLE.node;
  const m = measureRichText(html, { fontSize: s.font, fontWeight: s.weight, maxWidth: s.maxText, whiteSpace: 'pre-wrap' });
  // +1: sub-pixel safety so the rendered line never wraps where the measured one didn't.
  return { w: Math.max(s.minW, m.w + 1 + s.padX * 2), h: m.h + s.padY * 2 };
}
