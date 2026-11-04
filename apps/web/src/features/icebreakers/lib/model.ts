// Pure helpers of icebreakers (#150): sizes, starting content, and where an animation is at a given
// moment of the SERVER's clock — so every client draws the same frame of the same spin.
import type { IcebreakerElement, IcebreakerResult } from '@freero/shared';

import { t } from '../messages';
export const RESULTS = 'icebreakerResults';
export const TOOL_ID = 'icebreakers';
export type Kind = IcebreakerElement['kind'];

export const KINDS: ReadonlyArray<{ value: Kind; label: string }> = [
  { value: 'wheel', label: t('wheelOfNames') },
  { value: 'dice', label: t('dice') },
  { value: 'speakers', label: t('speakingOrder') },
];

export const SIZE: Record<Kind, { w: number; h: number }> = {
  wheel: { w: 360, h: 440 },
  dice: { w: 320, h: 230 },
  speakers: { w: 300, h: 380 },
};

export const TITLES: Record<Kind, string> = { wheel: t('whoGoesNext'), dice: t('rollTheDice'), speakers: t('speakingOrder') };
export const STARTER_ENTRIES = ['Ann', 'Bo', 'Cy', 'Dee'];
export const COLORS = ['#5B3FF0', '#2E9BF0', '#14B8A6', '#1FA463', '#F5A524', '#F97316', '#E5484D', '#E64DA6'];
/** Full turns a wheel makes before landing. */
export const TURNS = 5;

/** The entries a result is drawn from (as the server trims them). */
export const entriesOf = (el: Pick<IcebreakerElement, 'entries'>): string[] => (el.entries ?? []).map((e) => e.trim()).filter(Boolean);

/** 0..1 through the animation at server time `now` (1: done, or no result). */
export function progress(r: IcebreakerResult | undefined, now: number): number {
  if (!r || r.ms <= 0) return 1;
  return Math.min(1, Math.max(0, (now - r.at) / r.ms));
}

/** Fast start, long gentle stop. */
export const easeOut = (p: number): number => 1 - (1 - p) ** 4;

/**
 * The wheel's rotation (degrees, clockwise) at progress `p` of result `r`: slice `index` of `of`
 * ends under the pointer at the top, after TURNS full turns. Slice i spans i·seg..(i+1)·seg.
 */
export function wheelAngle(r: Pick<IcebreakerResult, 'index' | 'of'> | undefined, p: number): number {
  if (!r || r.index === undefined || !r.of) return 0;
  const seg = 360 / r.of;
  const final = 360 - (r.index * seg + seg / 2);
  return final - (1 - easeOut(p)) * TURNS * 360;
}

/** What a finished result says, for screen readers and the caption. */
export function resultText(r: IcebreakerResult): string {
  if (r.picked !== undefined) return r.picked;
  if (r.dice) return r.dice.length > 1 ? `${r.dice.join(' + ')} = ${r.dice.reduce((s, d) => s + d, 0)}` : String(r.dice[0]);
  if (r.order) return r.order.map((n, i) => `${i + 1}. ${n}`).join(', ');
  return '';
}
