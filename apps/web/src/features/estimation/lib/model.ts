// Planning poker (KAI-131): the `estimation` collection.
//
//   'round'                          -> Round (the running one; starting another replaces it)
//   `v:${roundId}:${itemId}:${userId}` -> Estimate. While an item is being estimated the real
//                                       value is in the voter's PRIVATE layer (the server sends
//                                       it to nobody else) and the shared key holds only a sealed
//                                       marker ("has picked a card"). Revealing an item moves every
//                                       voter's value into the shared collection on the server.
//
// One key per voter per item, so concurrent picks never overwrite each other, and a second tab of
// the same person replaces their pick instead of adding one.

export type DeckKind = 'fibonacci' | 'tshirt' | 'custom';

export interface Deck {
  kind: DeckKind;
  values: string[];
}

export const DECKS: Record<Exclude<DeckKind, 'custom'>, { label: string; values: string[] }> = {
  fibonacci: { label: 'Fibonacci', values: ['0', '1', '2', '3', '5', '8', '13', '21', '?'] },
  tshirt: { label: 'T-shirt sizes', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?'] },
};

export const MAX_VALUES = 16;
const MAX_VALUE_LENGTH = 8;

/** A custom deck from "1, 2, 4, 8": trimmed, distinct, short, at most MAX_VALUES. Null if fewer than two. */
export function parseCustomDeck(input: string): string[] | null {
  const out: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const v = raw.trim().slice(0, MAX_VALUE_LENGTH);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.length >= 2 ? out.slice(0, MAX_VALUES) : null;
}

export interface Round {
  id: string;
  /** What is estimated, in order (cards, stickies). */
  itemIds: string[];
  /** The item being estimated now. */
  index: number;
  deck: Deck;
  /** The current item's estimates are revealed. */
  revealed: boolean;
  startedBy: string;
  startedByName: string;
  startedAt: number;
}

export interface Estimate {
  roundId: string;
  itemId: string;
  userId: string;
  userName: string;
  userColor: string;
  /** The picked value; absent on the sealed marker. */
  value?: string;
  sealed?: boolean;
}

export type EstimationValue = Round | Estimate;

export const ROUND_KEY = 'round';
export const voteKey = (roundId: string, itemId: string, userId: string) => `v:${roundId}:${itemId}:${userId}`;
export const itemPrefix = (roundId: string, itemId: string) => `v:${roundId}:${itemId}:`;

export function readRound(v: unknown): Round | undefined {
  const r = v as Partial<Round> | undefined;
  if (!r || typeof r.id !== 'string' || !Array.isArray(r.itemIds) || !r.deck || !Array.isArray(r.deck.values)) return undefined;
  return r as Round;
}

/** Estimates of `itemId` in `round` (markers included), one per voter, from a collection's entries. */
export function estimatesOf(entries: Array<[string, unknown]>, round: Round, itemId: string): Estimate[] {
  const prefix = itemPrefix(round.id, itemId);
  const out: Estimate[] = [];
  for (const [key, v] of entries) {
    if (!key.startsWith(prefix)) continue;
    const e = v as Partial<Estimate>;
    if (!e || typeof e.userId !== 'string' || key !== voteKey(round.id, itemId, e.userId)) continue;
    out.push(e as Estimate);
  }
  return out;
}

// ---------------------------------------------------------------- results

/** A deck value as a number ('½' = 0.5), or null for '?', sizes and the like. */
export function numeric(value: string): number | null {
  if (value === '½') return 0.5;
  const n = Number(value.replace(',', '.'));
  return value.trim() !== '' && Number.isFinite(n) ? n : null;
}

export interface Results {
  /** Values that were picked, in deck order, with who picked each. */
  distribution: Array<{ value: string; voters: Estimate[] }>;
  /** Everyone picked the same value. */
  consensus: boolean;
  /** Numeric picks only ("?" and sizes left out). */
  average: number | null;
  median: number | null;
  min: string | null;
  max: string | null;
  /** The value to accept by default: the most picked one; a tie goes to the larger (deck order). */
  suggestion: string | null;
  /** Voters whose pick is two or more deck steps away from the suggestion (worth hearing first). */
  outliers: string[];
}

export function results(estimates: Estimate[], deck: Deck): Results {
  const picked = estimates.filter((e) => typeof e.value === 'string');
  const order = (v: string) => {
    const i = deck.values.indexOf(v);
    return i < 0 ? deck.values.length : i;
  };
  const byValue = new Map<string, Estimate[]>();
  for (const e of picked) byValue.set(e.value!, [...(byValue.get(e.value!) ?? []), e]);
  const distribution = [...byValue].map(([value, voters]) => ({ value, voters })).sort((a, b) => order(a.value) - order(b.value));

  const nums = picked.map((e) => numeric(e.value!)).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const average = nums.length ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10 : null;
  const median = nums.length ? (nums.length % 2 ? nums[(nums.length - 1) / 2] : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2) : null;
  const ranked = distribution.filter((d) => d.value !== '?');
  let suggestion: string | null = null;
  let best = 0;
  for (const d of ranked) if (d.voters.length >= best) ((best = d.voters.length), (suggestion = d.value));
  const known = ranked.map((d) => d.value);
  const outliers =
    suggestion === null
      ? []
      : picked.filter((e) => e.value !== '?' && Math.abs(order(e.value!) - order(suggestion!)) >= 2).map((e) => e.userId);
  return {
    distribution,
    consensus: distribution.length === 1 && picked.length > 1,
    average,
    median,
    min: known[0] ?? null,
    max: known[known.length - 1] ?? null,
    suggestion,
    outliers,
  };
}
