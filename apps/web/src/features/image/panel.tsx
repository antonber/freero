import { definePanel } from '@engine';
import { usePending } from './lib/pending';
import { CropOverlay } from './lib/CropOverlay';
import { CROP_PANEL } from './lib/cropping';

export default [
  /** Local shimmer placeholders where uploading images will land (world space, not synced). */
  definePanel({
    id: 'image.pending',
    slot: 'world-overlay',
    order: 0,
    Component: () => {
      const pending = usePending();
      return (
        <>
          {pending.map((r, i) => (
            <div
              key={i}
              className="fr-image-pending"
              style={{ width: r.w, height: r.h, transform: `translate(${r.x}px, ${r.y}px)` }}
              aria-label="Uploading image"
            />
          ))}
        </>
      );
    },
  }),
  /** Crop mode: editor.openPanel(CROP_PANEL, { id }). */
  definePanel({ id: CROP_PANEL, slot: 'dialog', order: 0, minRole: 'editor', Component: CropOverlay }),
];
