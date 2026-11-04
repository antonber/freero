// Slide layouts (KAI-126, #52): Freero's own arrangements of editable text (and an image area)
// inside a slide frame, sized to the frame. Pure: frame rect in, element drafts out (frame-local
// values scale with the frame, so a 4:3 slide or a phone frame gets the same proportions). Every
// part carries its `layoutRole`, so applying another layout later replaces the parts instead of
// piling a second layout on top (`relayoutPlan`).
import { plainToRichText, richTextToPlain, type BoardElement, type SlideLayoutRole } from '@freero/shared';
import type { NewElement, Rect } from '@engine';

import { t } from '../messages';
export type SlideLayoutId = 'title' | 'title-body' | 'two-columns' | 'image-text' | 'big-number' | 'quote';

export const SLIDE_LAYOUTS: Array<{ id: SlideLayoutId; label: string; hint: string }> = [
  { id: 'title', label: t('title'), hint: t('aBigTitleAndA') },
  { id: 'title-body', label: t('titleAndBody'), hint: t('aHeadingOverAList') },
  { id: 'two-columns', label: t('twoColumns'), hint: t('aHeadingOverTwoSide') },
  { id: 'image-text', label: t('imageAndText'), hint: t('anImageAreaBesideA') },
  { id: 'big-number', label: t('bigNumber'), hint: t('oneFigureLargeWithWhat') },
  { id: 'quote', label: t('quote'), hint: t('aQuotationAndWhoSaid') },
];

const INK = '#17162B';
const MUTED = '#4B4A63';

export type LayoutDraft = (NewElement<'text'> | NewElement<'shape'>) & { layoutRole: SlideLayoutRole };

/** What each part says until someone writes in it. */
const PLACEHOLDER = {
  title: t('slideTitle'),
  deckTitle: t('presentationTitle'),
  subtitle: t('subtitleOrPresenterName'),
  body: t('firstPointSecondPointThird'),
  image: t('imagePasteOrDropOne'),
  number: '42%',
  caption: t('whatThisNumberMeans'),
  quote: t('aSentenceWorthRemembering'),
  attribution: '— Who said it',
};

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const UNTOUCHED = new Set(Object.values(PLACEHOLDER).map(norm));

/** A layout part still showing its placeholder text (nobody wrote in it). */
export function isUntouched(el: Pick<BoardElement, 'type'> & { text?: unknown }): boolean {
  return UNTOUCHED.has(norm(richTextToPlain(typeof el.text === 'string' ? el.text : '')));
}

function text(
  role: SlideLayoutRole,
  x: number,
  y: number,
  w: number,
  h: number,
  content: string,
  size: number,
  opts: { align?: 'left' | 'center' | 'right'; color?: string; bold?: boolean; italic?: boolean; family?: 'sans' | 'serif' } = {},
): LayoutDraft {
  let html = content
    .split('\n')
    .map((l) => `<p>${plainToRichText(l)}</p>`)
    .join('');
  if (opts.bold) html = `<b>${plainToRichText(content)}</b>`;
  if (opts.italic) html = `<i>${html}</i>`;
  return {
    type: 'text',
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    text: html,
    fontFamily: opts.family ?? 'sans',
    fontSize: Math.max(10, Math.round(size)),
    textColor: opts.color ?? INK,
    align: opts.align ?? 'left',
    background: 'transparent',
    autoWidth: false,
    layoutRole: role,
  } as LayoutDraft;
}

/**
 * The items a layout puts into a slide at `frame`: world coordinates, all inside the frame with
 * a margin (so the engine's membership rule puts them in it), `frameId` and `layoutRole` set.
 */
export function layoutItems(frame: Rect & { id: string }, layout: SlideLayoutId): LayoutDraft[] {
  // Everything scales from a 1280 × 720 design, by the frame's shorter side.
  const k = Math.min(frame.w / 1280, frame.h / 720);
  const m = Math.round(72 * k);
  const x0 = frame.x + m;
  const y0 = frame.y + m;
  const w = frame.w - m * 2;
  const h = frame.h - m * 2;
  const headH = 90 * k;
  const gap = 48 * k;
  const midY = frame.y + frame.h / 2;
  let items: LayoutDraft[];
  switch (layout) {
    case 'title':
      items = [
        text('title', x0, frame.y + frame.h * 0.34, w, 120 * k, PLACEHOLDER.deckTitle, 72 * k, { align: 'center', bold: true }),
        text('subtitle', x0, frame.y + frame.h * 0.34 + 140 * k, w, 60 * k, PLACEHOLDER.subtitle, 32 * k, { align: 'center', color: MUTED }),
      ];
      break;
    case 'title-body':
      items = [text('title', x0, y0, w, headH, PLACEHOLDER.title, 56 * k, { bold: true }), text('body', x0, y0 + headH + gap, w, h - headH - gap, PLACEHOLDER.body, 30 * k)];
      break;
    case 'two-columns': {
      const cw = (w - gap) / 2;
      items = [
        text('title', x0, y0, w, headH, PLACEHOLDER.title, 56 * k, { bold: true }),
        text('body', x0, y0 + headH + gap, cw, h - headH - gap, PLACEHOLDER.body, 28 * k),
        text('body2', x0 + cw + gap, y0 + headH + gap, cw, h - headH - gap, PLACEHOLDER.body, 28 * k),
      ];
      break;
    }
    case 'image-text': {
      const iw = (w - gap) * 0.55;
      const image = {
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
        text: `<p>${plainToRichText(PLACEHOLDER.image)}</p>`,
        fontSize: Math.max(12, Math.round(22 * k)),
        textColor: MUTED,
        layoutRole: 'image',
      } as unknown as LayoutDraft;
      items = [
        image,
        text('title', x0 + iw + gap, y0, w - iw - gap, headH * 1.6, PLACEHOLDER.title, 48 * k, { bold: true }),
        text('body', x0 + iw + gap, y0 + headH * 1.6 + gap / 2, w - iw - gap, h - headH * 1.6 - gap / 2, PLACEHOLDER.body, 26 * k),
      ];
      break;
    }
    case 'big-number': {
      const numH = 260 * k;
      items = [
        text('title', x0, y0, w, headH, PLACEHOLDER.title, 44 * k, { bold: true }),
        text('number', x0, midY - numH / 2, w, numH, PLACEHOLDER.number, 200 * k, { align: 'center', bold: true }),
        text('caption', x0, midY + numH / 2 + gap / 2, w, 60 * k, PLACEHOLDER.caption, 32 * k, { align: 'center', color: MUTED }),
      ];
      break;
    }
    case 'quote': {
      const qh = 300 * k;
      items = [
        text('quote', x0 + 60 * k, midY - qh / 2 - 30 * k, w - 120 * k, qh, PLACEHOLDER.quote, 54 * k, { align: 'center', italic: true, family: 'serif' }),
        text('caption', x0 + 60 * k, midY + qh / 2 - 10 * k, w - 120 * k, 60 * k, PLACEHOLDER.attribution, 30 * k, { align: 'right', color: MUTED }),
      ];
      break;
    }
  }
  return items.map((d) => ({ ...d, frameId: frame.id }));
}

/** Where a part people filled in goes in another layout: its own slot, else the nearest kind. */
const MOVES_TO: Record<SlideLayoutRole, SlideLayoutRole[]> = {
  title: ['title'],
  subtitle: ['subtitle', 'caption', 'body'],
  body: ['body', 'quote', 'body2', 'subtitle'],
  body2: ['body2', 'body'],
  image: ['image'],
  number: ['number', 'title'],
  quote: ['quote', 'body'],
  caption: ['caption', 'subtitle', 'body'],
};

export interface RelayoutPlan {
  /** New parts to create (some carrying text moved from the old layout). */
  create: LayoutDraft[];
  /** Old parts nobody wrote in, and filled ones whose content moved into a new part. */
  remove: string[];
  /** A picture that filled the old image slot, refitted into the new one. */
  move: Array<{ id: string; rect: Rect }>;
  /** Filled parts the new layout has no place for: they stay as they are, as ordinary items. */
  release: string[];
}

/** Box of `natural` aspect inside `slot`, centered (a picture moved into another image slot). */
function containIn(slot: Rect, w: number, h: number): Rect {
  if (!(w > 0 && h > 0)) return slot;
  const s = Math.min(slot.w / w, slot.h / h);
  const rw = Math.round(w * s);
  const rh = Math.round(h * s);
  return { x: Math.round(slot.x + (slot.w - rw) / 2), y: Math.round(slot.y + (slot.h - rh) / 2), w: rw, h: rh };
}

/**
 * Applying a layout to a slide that already has one: the old parts that still show their
 * placeholder go, the text people wrote moves into the new layout's matching slot (keeping its
 * formatting), a picture in the image slot moves into the new image slot, and whatever has no
 * place in the new layout stays where it is.
 */
export function relayoutPlan(existing: readonly BoardElement[], fresh: readonly LayoutDraft[]): RelayoutPlan {
  const create = fresh.map((d) => ({ ...d }));
  const taken = new Set<number>();
  const plan: RelayoutPlan = { create, remove: [], move: [], release: [] };
  const slotFor = (role: SlideLayoutRole) => {
    for (const r of MOVES_TO[role]) {
      const i = create.findIndex((d, j) => d.layoutRole === r && !taken.has(j));
      if (i >= 0) return i;
    }
    return -1;
  };
  for (const el of existing) {
    const role = el.layoutRole;
    if (!role) continue;
    if (role === 'image' && el.type !== 'image') {
      plan.remove.push(el.id);
      continue;
    }
    if (el.type !== 'image' && isUntouched(el as BoardElement & { text?: unknown })) {
      plan.remove.push(el.id);
      continue;
    }
    const i = slotFor(role);
    if (i < 0) {
      plan.release.push(el.id);
      continue;
    }
    taken.add(i);
    if (el.type === 'image') {
      const slot = create[i];
      plan.move.push({ id: el.id, rect: containIn(slot, el.naturalW || el.w, el.naturalH || el.h) });
      create.splice(i, 1, { ...slot, w: 0 } as LayoutDraft); // the slot is filled: no placeholder
      continue;
    }
    const html = (el as BoardElement & { text?: unknown }).text;
    if (typeof html === 'string') create[i] = { ...create[i], text: html } as LayoutDraft;
    plan.remove.push(el.id);
  }
  plan.create = create.filter((d) => d.w > 0);
  return plan;
}
