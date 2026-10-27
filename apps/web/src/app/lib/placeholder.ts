// Deterministic, pleasant thumbnail placeholders for boards without a saved
// thumbnail: a seeded mini "board" of stickies, shapes and a connector.

export interface PlaceholderShape {
  kind: 'sticky' | 'circle' | 'pill';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  rotate: number;
}

export interface PlaceholderSpec {
  bg: string;
  dot: string;
  shapes: PlaceholderShape[];
  /** Connector path between two shapes (SVG path data in a 320×200 box). */
  link: string;
  linkColor: string;
}

const PALETTES = [
  { bg: '#f4f1ff', dot: '#d9d2fb', colors: ['#ffe36e', '#b5a4ff', '#7ce8c9', '#ffb3c7'], link: '#5b3ff0' },
  { bg: '#eefaf6', dot: '#c7eadd', colors: ['#7ce8c9', '#ffe36e', '#9fd3ff', '#ffc89b'], link: '#1f9d7a' },
  { bg: '#fff6ec', dot: '#f3dcc0', colors: ['#ffc89b', '#ffe36e', '#ffb3c7', '#b5a4ff'], link: '#e8590c' },
  { bg: '#eef5ff', dot: '#cddff5', colors: ['#9fd3ff', '#b5a4ff', '#ffe36e', '#7ce8c9'], link: '#1c7ed6' },
  { bg: '#fdf0f5', dot: '#f2d0de', colors: ['#ffb3c7', '#ffe36e', '#b5a4ff', '#9fd3ff'], link: '#d6336c' },
  { bg: '#f6f6f2', dot: '#dcdccf', colors: ['#ffe36e', '#ffc89b', '#7ce8c9', '#9fd3ff'], link: '#4b4a63' },
];

/** FNV-1a 32-bit hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function placeholderFor(id: string): PlaceholderSpec {
  const h = hashString(id);
  const p = PALETTES[h % PALETTES.length];
  const r = rng(h);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)];
  const shapes: PlaceholderShape[] = [];

  // A loose cluster of stickies on the left/center, plus one or two shapes on the right.
  const cols = 2 + Math.floor(r() * 2); // 2..3
  const rows = 2;
  const size = 44;
  const ox = 34 + r() * 30;
  const oy = 38 + r() * 20;
  for (let c = 0; c < cols; c++) {
    for (let row = 0; row < rows; row++) {
      if (r() < 0.22) continue;
      shapes.push({
        kind: 'sticky',
        x: ox + c * (size + 10) + (r() - 0.5) * 6,
        y: oy + row * (size + 12) + (r() - 0.5) * 6,
        w: size,
        h: size,
        color: pick(p.colors),
        rotate: (r() - 0.5) * 8,
      });
    }
  }
  if (shapes.length === 0) {
    shapes.push({ kind: 'sticky', x: ox, y: oy, w: size, h: size, color: p.colors[0], rotate: -3 });
  }
  const rightX = 220 + r() * 20;
  shapes.push({
    kind: r() < 0.5 ? 'circle' : 'pill',
    x: rightX,
    y: 46 + r() * 20,
    w: 56,
    h: r() < 0.5 ? 56 : 34,
    color: pick(p.colors),
    rotate: 0,
  });
  if (r() < 0.6) {
    shapes.push({ kind: 'pill', x: rightX - 6, y: 130 + r() * 14, w: 70, h: 26, color: pick(p.colors), rotate: 0 });
  }

  const from = shapes[Math.min(shapes.length - 2, cols)] ?? shapes[0];
  const to = shapes[shapes.length - (shapes[shapes.length - 1].y > 120 ? 2 : 1)];
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const mx = (x1 + x2) / 2;
  const link = `M${x1.toFixed(1)} ${y1.toFixed(1)} C${mx.toFixed(1)} ${y1.toFixed(1)} ${mx.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;

  return { bg: p.bg, dot: p.dot, shapes, link, linkColor: p.link };
}

const PERSON_COLORS = ['#E8590C', '#2F9E44', '#1C7ED6', '#9C36B5', '#D6336C', '#0C8599', '#F08C00', '#5F3DC4'];

/** Stable avatar color for a person we only know by id (e.g. a board owner). */
export function personColor(id: string): string {
  return PERSON_COLORS[hashString(id) % PERSON_COLORS.length];
}
