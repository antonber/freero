// The screenshot of "Report a problem": the visible app (board, chrome, menus, dialogs) as the
// person sees it right now, rasterised with html-to-image (MIT, already the board export's
// renderer) and loaded only when someone reports. Downscaled to at most MAX_WIDTH pixels wide and
// compressed as JPEG until it fits well under the server's cap.
import { MAX_PROBLEM_SCREENSHOT_BYTES } from '@freero/shared';

const MAX_WIDTH = 1600;
/** Aim well under the server's cap (headroom for slow uploads on phones). */
const TARGET_BYTES = Math.min(900 * 1024, MAX_PROBLEM_SCREENSHOT_BYTES);
const QUALITIES = [0.82, 0.7, 0.55, 0.4];
/** 1×1 transparent GIF for images that can't be read (another origin without CORS). */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** Elements marked with this attribute are left out (the report UI itself). */
export const SKIP_IN_SCREENSHOT = 'data-fr-problem-skip';

const toBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

function scaled(canvas: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width * factor));
  out.height = Math.max(1, Math.round(canvas.height * factor));
  const ctx = out.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
  }
  return out;
}

/** A JPEG of what the window shows now, or null when the browser can't make one. */
export async function captureScreen(): Promise<Blob | null> {
  const [{ toCanvas }, { fontEmbedCss }] = await Promise.all([import('html-to-image'), import('@engine')]);
  const root = document.body;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_WIDTH / Math.max(1, width));
  const background = getComputedStyle(root).backgroundColor;
  const canvas = await toCanvas(root, {
    width,
    height,
    pixelRatio,
    canvasWidth: width,
    canvasHeight: height,
    backgroundColor: background && background !== 'rgba(0, 0, 0, 0)' ? background : '#ffffff',
    // Our own font CSS (as board exports do): html-to-image never reads the cross-origin font sheet.
    fontEmbedCSS: await fontEmbedCss(root).catch(() => ''),
    imagePlaceholder: BLANK,
    cacheBust: false,
    // What the page has scrolled to (a long dashboard) is where the picture starts.
    style: { margin: '0', transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` },
    filter: (node) => !(node instanceof HTMLElement && node.hasAttribute(SKIP_IN_SCREENSHOT)),
  });
  let current = canvas;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const q of QUALITIES) {
      const blob = await toBlob(current, q);
      if (blob && blob.size <= TARGET_BYTES) return blob;
    }
    current = scaled(current, 0.7);
  }
  const last = await toBlob(current, 0.4);
  return last && last.size <= MAX_PROBLEM_SCREENSHOT_BYTES ? last : null;
}
