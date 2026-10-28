import { memo, useCallback, useState } from 'react';
import { Image as ImageIcon, ImageOff } from 'lucide-react';
import type { ImageElement } from '@freero/shared';
import { defineElement, useIsExporting, type ElementRenderProps, type NewElement } from '@engine';
import { imageUrlFromPaste } from './lib/files';
import { insertImageFiles, insertImageUrl } from './lib/insert';
import { visibleCrop } from './lib/crop';
import { CROP_PANEL, useIsCropping } from './lib/cropping';
import './image.css';

type Status = 'loading' | 'loaded' | 'error';

const ImageView = memo(function ImageView({ element }: ElementRenderProps<ImageElement>) {
  const { src, alt } = element;
  // While this tab crops it, the crop overlay draws the whole picture here instead.
  const cropping = useIsCropping(element.id);
  const exporting = useIsExporting();
  const hidden = cropping && !exporting;
  // Status is tracked per src so replacing the image shows the shimmer again.
  const [status, setStatus] = useState<{ src: string; state: Status }>({ src, state: 'loading' });
  const state: Status = !src ? 'loading' : status.src === src ? status.state : 'loading';
  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      // Already decoded (cache): the load event may have fired before React attached it.
      if (img?.complete && img.naturalWidth > 0) setStatus((s) => (s.src === src && s.state === 'loaded' ? s : { src, state: 'loaded' }));
    },
    [src],
  );
  // A crop shows part of the picture: the img is scaled and shifted inside the clipped box, in
  // percentages of the box so it is zoom-independent and exports exactly as drawn.
  const c = element.crop ? visibleCrop(element) : null;
  const cropStyle = c
    ? { width: `${100 / c.w}%`, height: `${100 / c.h}%`, left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%` }
    : undefined;
  return (
    <div className="fr-image" data-state={state} data-cropped={c ? '' : undefined} style={hidden ? { visibility: 'hidden' } : undefined}>
      {src && state !== 'error' && (
        <img
          ref={ref}
          style={cropStyle}
          src={src}
          alt={alt ?? ''}
          draggable={false}
          decoding="async"
          onLoad={() => setStatus({ src, state: 'loaded' })}
          onError={() => setStatus({ src, state: 'error' })}
        />
      )}
      {state === 'loading' && <div className="fr-image__shimmer" aria-label="Loading image" />}
      {state === 'error' && (
        <div className="fr-image__error" role="img" aria-label={alt ? `Image unavailable: ${alt}` : 'Image unavailable'}>
          <ImageOff size={Math.max(16, Math.min(40, Math.min(element.w, element.h) / 4))} strokeWidth={1.6} />
          {element.w >= 120 && element.h >= 80 && <span>Image unavailable</span>}
        </div>
      )}
    </div>
  );
});

export default defineElement({
  type: 'image',
  label: { one: 'Image', many: 'Images' },
  icon: ImageIcon,
  resize: 'aspect',
  minSize: { w: 24, h: 24 },
  defaults: (): Omit<NewElement<'image'>, 'x' | 'y'> => ({
    type: 'image',
    w: 320,
    h: 240,
    src: '',
    naturalW: 0,
    naturalH: 0,
    alt: '',
  }),
  Component: ImageView,
  // Double-click = crop (images have no text to edit).
  onDoubleClick: (el, { editor }) => {
    if (el.src && el.naturalW > 0) editor.openPanel(CROP_PANEL, { id: el.id });
  },
  toPlainText: (el) => el.alt ?? '',
  // Images claim pasted/dropped image files, image URLs and data URLs before any text importer.
  importPriority: 100,
  importData(editor, data, at) {
    if (data.files.some((f) => f.type.startsWith('image/'))) {
      // Claimed right away; the upload continues in the background with local placeholders.
      void insertImageFiles(editor, data.files, at);
      return true;
    }
    if (data.files.length) return false;
    const url = imageUrlFromPaste(data.text, data.html);
    return url ? insertImageUrl(editor, url, at) : false;
  },
});
