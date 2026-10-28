// The command palette's search: fuzzy matching over the engine's live action list
// (Editor.listActions, the same registry the shortcut sheet reads), recent commands first.
import type { ActionEntry } from '@engine';
import { formatShortcut } from '@ui';
import { displayShortcut, sectionOf } from './sheet';

export const PALETTE_PANEL = 'shortcuts.palette';

export interface PaletteRow {
  entry: ActionEntry;
  /** Section it reads under ("Tools", "Editing", "Board settings", a feature). */
  section: string;
  /** Display-ready bindings ('?' instead of 'shift+/'). */
  keys: string[];
  recent: boolean;
}

const isWordStart = (text: string, i: number) => i === 0 || /[\s\-:/(›]/.test(text[i - 1]);

/**
 * How well one typed word matches `text` (lowercase): a word that starts there beats one inside
 * a word, which beats an abbreviation — the letters in order inside ONE word, starting with its
 * first letter ("algn" → "align", "frwd" → "forward"). Letters scattered across words never
 * match ("snap" is not "Select only stamps"). null = no match.
 */
export function wordScore(word: string, text: string): number | null {
  let best: number | null = null;
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
    const s = isWordStart(text, i) ? 100 - Math.min(i, 40) / 4 : 60 - Math.min(i, 40) / 4;
    if (best === null || s > best) best = s;
  }
  if (best !== null) return best;
  for (const w of text.split(/[^\p{L}\p{N}]+/u)) {
    if (!w || w[0] !== word[0]) continue;
    let at = 0;
    let gaps = 0;
    for (const ch of word.slice(1)) {
      const next = w.indexOf(ch, at + 1);
      if (next < 0) {
        at = -1;
        break;
      }
      gaps += next - at - 1;
      at = next;
    }
    if (at < 0 || gaps > word.length) continue;
    const s = 40 - gaps * 3;
    if (best === null || s > best) best = s;
  }
  return best;
}

/**
 * Score of a whole query: every word must match the label, its section or its keys (as this
 * platform prints them); label matches count most. null = not a result.
 */
export function matchScore(query: string, row: Omit<PaletteRow, 'recent'>, apple?: boolean): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const label = `${row.entry.label} ${row.entry.detail ?? ''}`.toLowerCase();
  const extra = [row.section, ...row.keys, ...row.keys.map((k) => formatShortcut(k, apple))].join(' ').toLowerCase();
  let total = 0;
  for (const w of words) {
    const inLabel = wordScore(w, label);
    // Section / keys only by substring: fuzzy letters across them match nearly anything.
    const inExtra = extra.includes(w) ? 30 : null;
    const s = Math.max(inLabel ?? -1, inExtra ?? -1);
    if (s < 0) return null;
    total += s;
  }
  return total;
}

/**
 * The rows to show for `query`: runnable actions before unavailable ones, then best match;
 * with an empty query the recently run ones (most recent first) lead — also while unavailable,
 * greyed out with why — then the rest in the registry's order. `recent` = action ids, most
 * recent first.
 */
export function rankActions(entries: ActionEntry[], query: string, recent: readonly string[], apple?: boolean): PaletteRow[] {
  const recentRank = new Map(recent.map((id, i) => [id, i]));
  const scored: Array<{ row: PaletteRow; score: number; index: number }> = [];
  entries.forEach((entry, index) => {
    const base = { entry, section: sectionOf(entry), keys: entry.shortcuts.map(displayShortcut) };
    const score = matchScore(query, base, apple);
    if (score === null) return;
    const r = recentRank.get(entry.id);
    // A recent action wins a near-tie, never a clearly better match.
    const boost = r === undefined ? 0 : 12 - r;
    scored.push({ row: { ...base, recent: r !== undefined }, score: score + boost, index });
  });
  const blank = !query.trim();
  scored.sort((a, b) => {
    if (blank) {
      const ra = recentRank.get(a.row.entry.id) ?? Infinity;
      const rb = recentRank.get(b.row.entry.id) ?? Infinity;
      if (ra !== rb) return ra - rb;
    }
    const da = a.row.entry.disabledReason ? 1 : 0;
    const db = b.row.entry.disabledReason ? 1 : 0;
    if (da !== db) return da - db;
    return blank ? a.index - b.index : b.score - a.score || a.index - b.index;
  });
  return scored.map((s) => s.row);
}

// ---------------------------------------------------------------- recent actions (this browser)
const MAX_RECENT = 6;
const key = (userId: string) => `freero.palette.recent.${userId}`;

/** Recently run action ids, most recent first. Empty when storage is unavailable. */
export function loadRecent(userId: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key(userId)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function rememberRecent(userId: string, id: string): void {
  const next = [id, ...loadRecent(userId).filter((x) => x !== id)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(key(userId), JSON.stringify(next));
  } catch {
    // Private mode / blocked storage: the palette still works, just without recents.
  }
}
