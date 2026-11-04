// Offscreen rendering for renderToDataUrl and thumbnails: mounts the requested elements (no
// culling, no editors) into a detached world clone, then rasterizes it with html-to-image in
// chunks of a bounded size, one per task, so the page keeps answering while a big board renders.
// Thumbnails draw only what is big enough to show detail in full; the rest are boxes
// (paintPlan.ts says what and why).
import { startTransition, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { toSvg } from 'html-to-image';
import type { BoardElement } from '@freero/shared';
import type { Rect } from '../api';
import { EngineContext, RenderModeContext } from '../context';
import type { EngineCore, ExportOptions } from '../runtime/core';
import { ElementFrame } from '../canvas/WorldLayer';
import { quantizeZoom } from '../camera/camera';
import { expandRect, rectUnion, visualAABB } from '../geometry/geometry';
import { compareRenderOrder } from '../geometry/spatial';
import { fontEmbedCss } from './fontEmbed';
import { createRemoteImageInliner } from './remoteImages';
import { CHUNK_NODES, chunkByCost, planThumbnail, swatchOf, type PaintStep } from './paintPlan';

const MAX_PIXELS_SIDE = 8192;
/** World px around a chunk's items that its picture keeps (shadows, chips drawn past the box). */
const CHUNK_PAD = 32;

function ExportWorld({ elements, rect, zoom, onReady }: { elements: BoardElement[]; rect: Rect; zoom: number; onReady: () => void }) {
  useLayoutEffect(onReady, [onReady]);
  return (
    // `fr-paper`: exports show the board's own colours whatever the page's theme (theme.ts).
    // The background is painted by the compositor below, once, not by every chunk.
    <div data-fr-export="" className="fr-paper" style={{ position: 'relative', width: rect.w, height: rect.h, overflow: 'hidden', background: 'transparent' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${-rect.x}px, ${-rect.y}px)` }}>
        {elements.map((el) => (
          <ElementFrame key={el.id} element={el} selected={false} editing={false} zoom={zoom} />
        ))}
      </div>
    </div>
  );
}

const nextFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * Hands the main thread back to the page for a moment (input, painting). A message, not a timer:
 * timers in a hidden tab wait a second or more, and the thumbnail is saved when the tab is hidden.
 */
const yieldToPage = () =>
  new Promise<void>((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });

/** How long an export waits for its pictures to arrive (slow connection, huge file) at most. */
const IMAGE_WAIT_MS = 15_000;

/**
 * Waits (capped) until every <img> in `node` has loaded or failed. Items that were never on
 * screen (culled, a far-away frame) aren't in the browser cache yet, and an image element still
 * "loading" draws its placeholder, not the picture. True when some had to be waited for.
 */
async function settleImages(node: HTMLElement): Promise<boolean> {
  const pending = Array.from(node.querySelectorAll('img')).filter((img) => !img.complete);
  if (!pending.length) return false;
  const settled = pending.map(
    (img) =>
      new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(settled), new Promise<void>((r) => (timer = setTimeout(r, IMAGE_WAIT_MS)))]);
  clearTimeout(timer);
  return true;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => void img.decode().then(() => resolve(img), () => resolve(img));
    img.onerror = () => reject(new Error('Could not draw part of the picture.'));
    img.src = url;
  });
}

const escapeAttr = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const SVG_PREFIX = 'data:image/svg+xml;charset=utf-8,';

/** A chunk of DOM-drawn items and the part of the picture (pixel-aligned, world units) it covers. */
interface Chunk {
  items: BoardElement[];
  box: Rect;
  blend?: string;
}
type Step = { kind: 'chunk'; chunk: Chunk } | { kind: 'boxes'; items: Array<{ el: BoardElement; color: string }> };

export function createExportRenderer(core: EngineCore) {
  const inlineRemoteImages = createRemoteImageInliner(() => core.hostRef.current);
  return async function renderExport(opts: ExportOptions): Promise<string> {
    // Never render synchronously inside a React commit/cleanup (thumbnail on leave).
    await Promise.resolve();
    const editor = core.editor;
    let elements: BoardElement[];
    // Board content, not this viewer's view: items hidden "for me" (setViewHidden) still export
    // (the dashboard thumbnail is everyone's); only items off the board (collapsed branches) don't.
    if (opts.ids) elements = editor.withChildren(opts.ids).map((id) => editor.getElement(id)!).filter((el) => el && !editor.isOffBoard(el));
    else if (opts.rect) elements = editor.elementsInRect(opts.rect, 'intersect');
    else elements = editor.getElements().filter((el) => !editor.isOffBoard(el));
    if (opts.sharedOnly) elements = elements.filter((el) => core.store.layerOf(el.id) === 'shared');
    elements.sort(compareRenderOrder);
    // Visual bounds: what definitions draw outside their box (frame titles) is part of the picture.
    const content = opts.rect ?? editor.visualBoundsOf(elements) ?? { x: 0, y: 0, w: 320, h: 200 };

    const rect = expandRect(content, opts.padding ?? (opts.rect ? 0 : 32));
    rect.w = Math.max(1, Math.ceil(rect.w));
    rect.h = Math.max(1, Math.ceil(rect.h));
    const background = opts.background === undefined ? editor.getSettings().background : opts.background;
    const scale = Math.min(opts.scale ?? 2, MAX_PIXELS_SIDE / Math.max(rect.w, rect.h));
    const W = Math.max(1, Math.round(rect.w * scale));
    const H = Math.max(1, Math.round(rect.h * scale));
    // A thumbnail draws each item as the canvas would at the picture's zoom (level of detail);
    // explicit exports draw everything in full.
    const zoom = opts.thumbnail ? Math.min(1, quantizeZoom(scale)) : 1;
    const definition = (el: BoardElement) => core.registry.elements.get(el.type)?.def;
    const plan: Array<PaintStep<BoardElement>> = opts.thumbnail
      ? planThumbnail(elements, scale, (el) => swatchOf(el, definition(el)))
      : elements.length
        ? [{ kind: 'dom', items: elements }]
        : [];
    const inDom = plan.flatMap((s) => (s.kind === 'dom' ? s.items : []));

    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
      position: 'fixed',
      left: '-100000px',
      top: '0',
      width: `${rect.w}px`,
      height: `${rect.h}px`,
      pointerEvents: 'none',
      fontFamily: 'var(--fr-font)',
    });
    // Pictures of the board are laid out as the board is, whatever the interface's direction (#5).
    host.dir = 'ltr';
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      let node: HTMLElement | null = null;
      let fontCss = '';
      if (inDom.length) {
        // A transition: React renders a big board in slices instead of one long task.
        await new Promise<void>((resolve) =>
          startTransition(() =>
            root.render(
              <EngineContext.Provider value={core}>
                <RenderModeContext.Provider value="export">
                  <ExportWorld elements={inDom} rect={rect} zoom={zoom} onReady={resolve} />
                </RenderModeContext.Provider>
              </EngineContext.Provider>,
            ),
          ),
        );
        await nextFrames();
        await document.fonts?.ready;
        node = host.firstElementChild as HTMLElement;
        // Third-party images become data URLs first, or html-to-image would drop the ones whose
        // host refuses cross-origin reads. Then wait for every picture to arrive, and let the image
        // components see their loads (they draw a placeholder until then).
        const images = await inlineRemoteImages(node);
        const waited = await settleImages(node);
        if (images.found || waited) await nextFrames();
        if (images.missing) opts.onMissingImages?.(images.missing);
        // Our own font CSS (see fontEmbed.ts): html-to-image then never reads the document's
        // stylesheets, whose cross-origin web-font sheet would log errors. '' = no fonts.
        fontCss = opts.skipFonts ? '' : await fontEmbedCss(node);
      }

      // Cut the DOM runs into chunks of bounded work, each covering only its items' part of the
      // picture (a big export doesn't rasterize the whole canvas per chunk).
      const world = node?.firstElementChild as HTMLElement | null;
      const wrappers = new Map<string, HTMLElement>();
      for (const child of Array.from(world?.children ?? [])) {
        const id = (child as HTMLElement).dataset.id;
        if (id) wrappers.set(id, child as HTMLElement);
      }
      const nodes = (el: BoardElement) => 1 + (wrappers.get(el.id)?.getElementsByTagName('*').length ?? 0);
      const blendOf = (el: BoardElement) => {
        const mode = definition(el)?.wrapperStyle?.(el as never)?.mixBlendMode;
        return mode && mode !== 'normal' ? String(mode) : undefined;
      };
      const steps: Step[] = [];
      for (const s of plan) {
        if (s.kind === 'boxes') steps.push({ kind: 'boxes', items: s.items });
        else
          for (const items of chunkByCost(s.items, nodes, CHUNK_NODES, (el) => !!blendOf(el)))
            steps.push({ kind: 'chunk', chunk: { items, box: rect, blend: blendOf(items[0]) } });
      }
      const whole = steps.length === 1;
      for (const s of steps) {
        if (s.kind !== 'chunk' || whole) continue;
        const outset = (el: BoardElement) => visualAABB(el, definition(el)?.visualOutset?.(el, zoom));
        const b = expandRect(rectUnion(s.chunk.items.map(outset))!, CHUNK_PAD);
        // Pixel-aligned, inside the picture, so chunks meet without resampling seams.
        const x0 = Math.max(0, Math.floor((b.x - rect.x) * scale));
        const y0 = Math.max(0, Math.floor((b.y - rect.y) * scale));
        const x1 = Math.min(W, Math.ceil((b.x + b.w - rect.x) * scale));
        const y1 = Math.min(H, Math.ceil((b.y + b.h - rect.y) * scale));
        s.chunk.box = { x: rect.x + x0 / scale, y: rect.y + y0 / scale, w: Math.max(1, x1 - x0) / scale, h: Math.max(1, y1 - y0) / scale };
      }

      const chunkSvg = (c: Chunk, withFonts: boolean) => {
        const shown = new Set(c.items.map((el) => wrappers.get(el.id)));
        return toSvg(node!, {
          width: c.box.w,
          height: c.box.h,
          // The whole world, moved so this chunk's part is at the picture's origin.
          style: { width: `${rect.w}px`, height: `${rect.h}px`, transform: `translate(${rect.x - c.box.x}px, ${rect.y - c.box.y}px)` },
          filter: (n) => n.parentElement !== world || shown.has(n),
          fontEmbedCSS: withFonts ? fontCss : '',
          skipFonts: !withFonts || !!opts.skipFonts,
          cacheBust: false,
        });
      };
      const total = steps.length;
      const progress = (done: number) => opts.onProgress?.(done, total);

      if (opts.format === 'svg') {
        const parts: string[] = [];
        if (background) parts.push(`<rect width="${rect.w}" height="${rect.h}" fill="${escapeAttr(background)}"/>`);
        let fonts = true;
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          if (s.kind === 'boxes') parts.push(boxesSvg(s.items, rect));
          else {
            // One copy of the font CSS: an SVG document's style sheets apply to all of it.
            const url = await chunkSvg(s.chunk, fonts);
            fonts = false;
            const inner = decodeURIComponent(url.slice(SVG_PREFIX.length));
            const style = s.chunk.blend ? ` style="mix-blend-mode:${escapeAttr(s.chunk.blend)}"` : '';
            parts.push(inner.replace(/^<svg /, `<svg x="${s.chunk.box.x - rect.x}" y="${s.chunk.box.y - rect.y}"${style} `));
            await yieldToPage();
          }
          progress(i + 1);
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.w}" height="${rect.h}" viewBox="0 0 ${rect.w} ${rect.h}">${parts.join('')}</svg>`;
        return SVG_PREFIX + encodeURIComponent(svg);
      }

      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create the picture.');
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, W, H);
      }
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        if (s.kind === 'boxes') paintBoxes(ctx, s.items, rect, scale);
        else {
          const img = await loadImage(await chunkSvg(s.chunk, true));
          const { box, blend } = s.chunk;
          ctx.globalCompositeOperation = (blend as GlobalCompositeOperation | undefined) ?? 'source-over';
          ctx.drawImage(img, Math.round((box.x - rect.x) * scale), Math.round((box.y - rect.y) * scale), Math.round(box.w * scale), Math.round(box.h * scale));
          ctx.globalCompositeOperation = 'source-over';
          await yieldToPage();
        }
        progress(i + 1);
      }
      return opts.format === 'jpeg' ? canvas.toDataURL('image/jpeg', 0.88) : canvas.toDataURL('image/png');
    } finally {
      root.unmount();
      host.remove();
    }
  };
}

/** Items too small to show detail: boxes of their swatch colour (at least a pixel). */
function paintBoxes(ctx: CanvasRenderingContext2D, items: Array<{ el: BoardElement; color: string }>, rect: Rect, scale: number) {
  for (const { el, color } of items) {
    ctx.fillStyle = '#B9B7CC'; // an unreadable colour string leaves this, not the previous box's
    ctx.fillStyle = color;
    // Boxes a few pixels big keep half a pixel apart, so a stack of cards still reads as many.
    const iw = el.w * scale > 3 ? 0.5 : 0;
    const ih = el.h * scale > 3 ? 0.5 : 0;
    const w = Math.max(1, el.w * scale - 2 * iw);
    const h = Math.max(1, el.h * scale - 2 * ih);
    const x = (el.x - rect.x) * scale + iw;
    const y = (el.y - rect.y) * scale + ih;
    if (!el.rotation) {
      ctx.fillRect(x, y, w, h);
      continue;
    }
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

function boxesSvg(items: Array<{ el: BoardElement; color: string }>, rect: Rect): string {
  return items
    .map(({ el, color }) => {
      const x = el.x - rect.x;
      const y = el.y - rect.y;
      const turn = el.rotation ? ` transform="rotate(${el.rotation} ${x + el.w / 2} ${y + el.h / 2})"` : '';
      return `<rect x="${x}" y="${y}" width="${el.w}" height="${el.h}" fill="${escapeAttr(color)}"${turn}/>`;
    })
    .join('');
}

const THUMB_W = 640;
const THUMB_ASPECT = 16 / 10;
const THUMB_EVERY_MS = 60_000;
const THUMB_FIRST_DELAY_MS = 5_000;

/**
 * Saves board thumbnails via host.saveThumbnail: throttled while the board is being edited
 * (first save ~5s after an edit, then at most once a minute) and once on leave. Editor+ only.
 */
export function startThumbnails(core: EngineCore): { stop(): Promise<void> } {
  let dirty = false;
  let saving = false;
  let lastSave = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = async () => {
    timer = null;
    if (!dirty || saving || !core.editor.can('editor') || !core.renderExport) return;
    const shared = core.store.getOrdered().filter((el) => core.store.layerOf(el.id) === 'shared' && !core.editor.isOffBoard(el));
    if (!shared.length) return;
    dirty = false;
    saving = true;
    lastSave = Date.now();
    try {
      // Everyone's thumbnail: shared content only (never private drafts or hidden frames' contents).
      const b = core.editor.visualBoundsOf(shared);
      if (!b) return;
      // Frame the content in a 16:10 card.
      let w = b.w + 120;
      let h = b.h + 120;
      if (w / h > THUMB_ASPECT) h = w / THUMB_ASPECT;
      else w = h * THUMB_ASPECT;
      const rect = { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
      const url = await core.renderExport({ rect, format: 'jpeg', scale: THUMB_W / w, padding: 0, skipFonts: true, sharedOnly: true, thumbnail: true });
      await core.hostRef.current.saveThumbnail(url);
    } catch (err) {
      dirty = true;
      console.warn('Thumbnail save failed', err);
    } finally {
      saving = false;
    }
  };
  const off = core.store.subscribeLocalChanges(() => {
    dirty = true;
    if (timer) return;
    const wait = Math.max(THUMB_FIRST_DELAY_MS, lastSave + THUMB_EVERY_MS - Date.now());
    timer = setTimeout(() => void save(), wait);
  });
  // Switching tabs or closing the window within the first-save delay would otherwise lose
  // the thumbnail; save as soon as the page is hidden.
  const onHidden = () => {
    if (document.visibilityState !== 'hidden' || !dirty) return;
    if (timer) clearTimeout(timer);
    void save();
  };
  document.addEventListener('visibilitychange', onHidden);
  return {
    async stop() {
      if (timer) clearTimeout(timer);
      off();
      document.removeEventListener('visibilitychange', onHidden);
      await save();
    },
  };
}
