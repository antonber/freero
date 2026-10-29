// Highlighted code as data: lines of text runs. The highlighter itself loads on first use; until it
// has, every block shows its text plain (same layout), and then re-renders highlighted.

/** A piece of one line and the highlight scopes around it (`hljs-keyword`…). */
export interface Run {
  text: string;
  scopes: string[];
}

export interface HighlightResult {
  lines: Run[][];
  /** The grammar used ('auto' → the guess), or null for plain text. */
  detected: string | null;
}

type Highlighter = typeof import('./highlighter');

let mod: Highlighter | null = null;
let loading: Promise<Highlighter> | null = null;
const listeners = new Set<() => void>();

/** Starts loading the highlighter (once); subscribers hear when it is ready. */
export function loadHighlighter(): Promise<Highlighter> {
  loading ??= import('./highlighter').then((m) => {
    mod = m;
    listeners.forEach((l) => l());
    return m;
  });
  return loading;
}

export function subscribeHighlighter(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const highlighterReady = (): boolean => mod !== null;

export function plainLines(code: string): Run[][] {
  return code.split('\n').map((t) => (t ? [{ text: t, scopes: [] }] : []));
}

// Small memo: a board re-renders blocks often (selection, zoom steps); highlighting is not free.
const cache = new Map<string, HighlightResult>();
const CACHE_MAX = 200;

/** Highlighted lines when the highlighter is loaded, else the plain text (and it starts loading). */
export function highlightNow(code: string, language: string): HighlightResult {
  if (!mod) {
    void loadHighlighter();
    return { lines: plainLines(code), detected: null };
  }
  const key = `${language}\u0000${code}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = mod.highlight(code, language);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, hit);
  }
  return hit;
}
