// Offscreen rendering for renderToDataUrl and thumbnails: mounts the requested elements (no
// culling, no editors) into a detached world clone, then rasterizes it with html-to-image.
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { toJpeg, toPng, toSvg } from 'html-to-image';
import type { BoardElement } from '@freero/shared';
import type { Rect } from '../api';
import { EngineContext, RenderModeContext } from '../context';
import type { EngineCore, ExportOptions } from '../runtime/core';
import { ElementFrame } from '../canvas/WorldLayer';
import { expandRect } from '../geometry/geometry';
import { compareRenderOrder } from '../geometry/spatial';
import { fontEmbedCss } from './fontEmbed';
import { createRemoteImageInliner } from './remoteImages';

const MAX_PIXELS_SIDE = 8192;

function ExportWorld({ elements, rect, background }: { elements: BoardElement[]; rect: Rect; background: string | null }) {
  return (
    <div data-fr-export="" style={{ position: 'relative', width: rect.w, height: rect.h, overflow: 'hidden', background: background ?? 'transparent' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${-rect.x}px, ${-rect.y}px)` }}>
        {elements.map((el) => (
          <ElementFrame key={el.id} element={el} selected={false} editing={false} zoom={1} />
        ))}
      </div>
    </div>
  );
}

const nextFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

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
    elements.sort(compareRenderOrder);
    // Visual bounds: what definitions draw outside their box (frame titles) is part of the picture.
    const content = opts.rect ?? editor.visualBoundsOf(elements) ?? { x: 0, y: 0, w: 320, h: 200 };

    const rect = expandRect(content, opts.padding ?? (opts.rect ? 0 : 32));
    rect.w = Math.max(1, Math.ceil(rect.w));
    rect.h = Math.max(1, Math.ceil(rect.h));
    const background = opts.background === undefined ? editor.getSettings().background : opts.background;
    const scale = Math.min(opts.scale ?? 2, MAX_PIXELS_SIDE / Math.max(rect.w, rect.h));

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
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      flushSync(() =>
        root.render(
          <EngineContext.Provider value={core}>
            <RenderModeContext.Provider value="export">
              <ExportWorld elements={elements} rect={rect} background={background} />
            </RenderModeContext.Provider>
          </EngineContext.Provider>,
        ),
      );
      await nextFrames();
      await document.fonts?.ready;
      const node = host.firstElementChild as HTMLElement;
      // Third-party images become data URLs first, or html-to-image would drop the ones whose
      // host refuses cross-origin reads. Then wait for every picture to arrive, and let the image
      // components see their loads (they draw a placeholder until then).
      const images = await inlineRemoteImages(node);
      const waited = await settleImages(node);
      if (images.found || waited) await nextFrames();
      if (images.missing) opts.onMissingImages?.(images.missing);
      const options = {
        width: rect.w,
        height: rect.h,
        pixelRatio: scale,
        backgroundColor: background ?? undefined,
        // Our own font CSS (see fontEmbed.ts): html-to-image then never reads the document's
        // stylesheets, whose cross-origin web-font sheet would log errors. '' = no fonts.
        fontEmbedCSS: opts.skipFonts ? '' : await fontEmbedCss(node),
        skipFonts: !!opts.skipFonts,
        cacheBust: false,
      };
      return await (opts.format === 'svg'
        ? toSvg(node, options)
        : opts.format === 'jpeg'
          ? toJpeg(node, { ...options, quality: 0.88 })
          : toPng(node, options));
    } finally {
      root.unmount();
      host.remove();
    }
  };
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
    if (!core.store.getOrdered().length) return;
    dirty = false;
    saving = true;
    lastSave = Date.now();
    try {
      const b = core.editor.getBounds(undefined, { visual: true });
      if (!b) return;
      // Frame the content in a 16:10 card.
      let w = b.w + 120;
      let h = b.h + 120;
      if (w / h > THUMB_ASPECT) h = w / THUMB_ASPECT;
      else w = h * THUMB_ASPECT;
      const rect = { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
      const url = await core.renderExport({ rect, format: 'jpeg', scale: THUMB_W / w, padding: 0, skipFonts: true });
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
