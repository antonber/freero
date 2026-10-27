import { memo, useCallback, useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { ImageElement } from '@freero/shared';
import { defineElement, type ElementRenderProps, type NewElement } from '@engine';
import { imageUrlFromPaste } from './lib/files';
import { insertImageFiles, insertImageUrl } from './lib/insert';
import './image.css';

type Status = 'loading' | 'loaded' | 'error';

const ImageView = memo(function ImageView({ element }: ElementRenderProps<ImageElement>) {
  const { src, alt } = element;
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
  return (
    <div className="fr-image" data-state={state}>
      {src && state !== 'error' && (
        <img
          ref={ref}
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
