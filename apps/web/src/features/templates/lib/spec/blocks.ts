// The pieces every archetype is made of: tones, text-height estimates, the frame header and the
// titled section with its guiding question and example notes. Archetypes measure a block first
// (to size the frame and line rows up), then draw it at that size.
import type { StickyColor } from '@freero/shared';
import { Kit, STICKY, rt } from '../kit';
import { AMBER, CORAL, HEAD, INK, INK_SOFT, MINT, ROSE, SKY, TINT, VIOLET } from '../palette';
import type { Section, Tone } from './types';

export const PAD = 48;
export const GAP = 16;
export const NOTE = STICKY;
/** Inner padding of a section. */
export const INSET = 24;
/** Narrowest frame: room for the longest allowed title. */
export const MIN_W = 960;

export const TONES: Record<Tone, { tint: string; head: string; accent: string; sticky: StickyColor }> = {
  violet: { tint: TINT.violet, head: HEAD.violet, accent: VIOLET, sticky: 'violet' },
  mint: { tint: TINT.mint, head: HEAD.mint, accent: MINT, sticky: 'green' },
  coral: { tint: TINT.coral, head: HEAD.coral, accent: CORAL, sticky: 'coral' },
  amber: { tint: TINT.amber, head: HEAD.amber, accent: AMBER, sticky: 'orange' },
  sky: { tint: TINT.sky, head: HEAD.sky, accent: SKY, sticky: 'blue' },
  rose: { tint: TINT.rose, head: HEAD.rose, accent: ROSE, sticky: 'pink' },
  gray: { tint: TINT.gray, head: HEAD.gray, accent: INK, sticky: 'yellow' },
};

/** Tones for sections that don't name one, in order. */
const CYCLE: Tone[] = ['violet', 'mint', 'sky', 'amber', 'rose', 'coral'];
export const toneAt = (tone: Tone | undefined, i: number, cycle: Tone[] = CYCLE): Tone => tone ?? cycle[i % cycle.length];

/**
 * Lines `text` wraps to in a box `w` wide, word by word. Deliberately generous (Inter averages
 * about half an em per character): an estimate that is too short lets measured text grow into
 * whatever sits below it.
 */
export function lineCount(text: string, w: number, size: number, bold = false): number {
  const per = Math.max(1, Math.floor(w / (size * (bold ? 0.6 : 0.54))));
  return text.split('\n').reduce((n, line) => {
    let lines = 1;
    let cur = 0;
    for (const word of line.split(/\s+/).filter(Boolean)) {
      if (cur === 0) cur = word.length;
      else if (cur + 1 + word.length <= per) cur += 1 + word.length;
      else {
        lines++;
        cur = word.length;
      }
      while (cur > per) {
        lines++;
        cur -= per;
      }
    }
    return n + lines;
  }, 0);
}

/** Height of a text element holding `text` (same line height the Kit's text uses). */
export const textHeight = (text: string, w: number, size: number, bold = false): number => Math.round(lineCount(text, w, size, bold) * size * 1.4 + 8);

const HINT = 16;
/** First free y below the frame header (title and hint) of a frame `W` wide. */
export const headerBottom = (hint: string, W: number): number => 92 + textHeight(hint, W - 2 * PAD, HINT) + 24;

/** The title and instruction at the top of every spec frame. */
export function header(k: Kit, title: string, hint: string, W: number): void {
  k.text(PAD, 40, W - 2 * PAD, `<b>${rt(title)}</b>`, { size: 32, h: 46 });
  k.text(PAD, 92, W - 2 * PAD, rt(hint), { size: HINT, color: INK_SOFT, h: textHeight(hint, W - 2 * PAD, HINT) });
}

export interface BlockStyle {
  /** Note size (default a full sticky). */
  note?: number;
  /** The archetype shows the title itself (a chevron, a funnel bar). */
  untitled?: boolean;
  /** `outline`: white with a dashed border, for loose clusters; `strong`: outlined in its accent (the hub's center). */
  look?: 'tint' | 'outline' | 'strong';
  /**
   * Height of the title and prompt, when a row of blocks shares one (`blockHead` of the tallest)
   * so their notes start at the same height.
   */
  head?: number;
}

type Block = Pick<Section, 'title' | 'prompt' | 'notes' | 'emoji'>;

const TITLE = 22;
const PROMPT = 15;
const EMOJI = 36;

export const notesPerRow = (w: number, note: number): number => Math.max(1, Math.floor((w - 2 * INSET + GAP) / (note + GAP)));

function titleHeight(b: Block, w: number): number {
  const tw = w - 2 * INSET - (b.emoji ? EMOJI + 8 : 0);
  return Math.max(textHeight(b.title, tw, TITLE, true), b.emoji ? EMOJI + 4 : 0);
}

/** Height of a block's title and prompt at width `w` (up to where its notes start). */
export function blockHead(b: Block, w: number, style: BlockStyle = {}): number {
  return 20 + (style.untitled ? 0 : titleHeight(b, w) + 4) + textHeight(b.prompt, w - 2 * INSET, PROMPT) + 12;
}

/** Height a block needs at width `w`. */
export function blockHeight(b: Block, w: number, style: BlockStyle = {}): number {
  const note = style.note ?? NOTE;
  const rows = Math.ceil(b.notes.length / notesPerRow(w, note));
  return Math.max(style.head ?? 0, blockHead(b, w, style)) + Math.max(0, rows * (note + GAP) - GAP) + INSET;
}

/** The shared head of blocks laid out side by side (each at its own width). */
export const rowHead = (items: Array<{ b: Block; w: number }>, style: BlockStyle = {}): number => Math.max(...items.map((i) => blockHead(i.b, i.w, style)));

/** Draws a block at (x, y), `w` × `h` (h from `blockHeight`, or more to line up a row). Returns its panel's id. */
export function drawBlock(k: Kit, x: number, y: number, w: number, h: number, b: Block, tone: Tone, style: BlockStyle = {}): string {
  const t = TONES[tone];
  const note = style.note ?? NOTE;
  const look = style.look ?? 'tint';
  const panel =
    look === 'outline'
      ? k.shape('roundRect', x, y, w, h, '', { fill: '#FFFFFF', stroke: t.head, strokeWidth: 3, strokeStyle: 'dashed' })
      : look === 'strong'
        ? k.shape('roundRect', x, y, w, h, '', { fill: t.tint, stroke: t.accent, strokeWidth: 4 })
        : k.panel(x, y, w, h, t.tint);
  let cy = y + 20;
  if (!style.untitled) {
    let tx = x + INSET;
    if (b.emoji) {
      k.emoji(tx, cy, EMOJI, b.emoji);
      tx += EMOJI + 8;
    }
    const th = textHeight(b.title, x + w - INSET - tx, TITLE, true);
    k.text(tx, cy + (b.emoji ? Math.max(0, (EMOJI - th) / 2) : 0), x + w - INSET - tx, `<b>${rt(b.title)}</b>`, { size: TITLE, color: t.accent, h: th });
    cy += titleHeight(b, w) + 4;
  }
  const ph = textHeight(b.prompt, w - 2 * INSET, PROMPT);
  k.text(x + INSET, cy, w - 2 * INSET, rt(b.prompt), { size: PROMPT, color: INK_SOFT, h: ph });
  k.stickies(x + INSET, y + Math.max(style.head ?? 0, blockHead(b, w, style)), w - 2 * INSET, b.notes, t.sticky, note);
  return panel;
}
