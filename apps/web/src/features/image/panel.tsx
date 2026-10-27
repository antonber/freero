import { definePanel } from '@engine';
import { usePending } from './lib/pending';

/** Local shimmer placeholders where uploading images will land (world space, not synced). */
export default definePanel({
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
});
