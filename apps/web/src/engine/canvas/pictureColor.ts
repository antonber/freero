// The colour a picture reads as from far away (#131: a picture in low detail is a box of it).
// Worked out once per picture, a few at a time, from an 8 × 8 copy; the decoded picture is let go
// afterwards, so a zoomed-out board of photos holds colours, not bitmaps. A picture the browser
// may not read back (another site's, without CORS) or that fails to load has none.

const colors = new Map<string, string | null>();
const waiting = new Map<string, Set<() => void>>();
const queue: string[] = [];
let running = 0;
const PARALLEL = 4;

/** `#rrggbb` average of RGBA pixels (transparent ones count for nothing); null when all are transparent. */
export function averageOf(data: ArrayLike<number>): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const w = data[i + 3] / 255;
    r += data[i] * w;
    g += data[i + 1] * w;
    b += data[i + 2] * w;
    a += w;
  }
  if (a < 1e-6) return null;
  const hex = (v: number) => Math.round(v / a).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

async function measure(src: string): Promise<string | null> {
  const img = new Image();
  img.decoding = 'async';
  // Another site's picture is read back only if it allows it (CORS); ours share the <img>'s cache.
  if (/^https?:/i.test(src) && new URL(src).origin !== location.origin) img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, 8, 8);
  return averageOf(ctx.getImageData(0, 0, 8, 8).data);
}

function pump() {
  while (running < PARALLEL && queue.length) {
    const src = queue.shift()!;
    running++;
    measure(src)
      .catch(() => null)
      .then((c) => {
        colors.set(src, c);
        const cbs = waiting.get(src);
        waiting.delete(src);
        running--;
        for (const cb of cbs ?? []) cb();
        pump();
      });
  }
}

/**
 * The colour the picture at `src` reads as: undefined while it is being worked out (`onReady` is
 * called once it is), null if it has none.
 */
export function pictureColor(src: string, onReady: () => void): string | null | undefined {
  if (colors.has(src)) return colors.get(src);
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  let cbs = waiting.get(src);
  if (!cbs) {
    waiting.set(src, (cbs = new Set()));
    queue.push(src);
    pump();
  }
  cbs.add(onReady);
  return undefined;
}
