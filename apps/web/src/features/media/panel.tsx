import { Loader2 } from 'lucide-react';
import { definePanel } from '@engine';
import { usePending } from './lib/pending';

/** Local placeholders where uploading files will land (world space, not synced). */
export default definePanel({
  id: 'media.pending',
  slot: 'world-overlay',
  order: 0,
  Component: () => {
    const pending = usePending();
    return (
      <>
        {pending.map((p, i) => (
          <div
            key={i}
            className="fr-media-pending"
            style={{ width: p.rect.w, height: p.rect.h, transform: `translate(${p.rect.x}px, ${p.rect.y}px)` }}
            aria-label={`Uploading ${p.name}`}
          >
            <Loader2 className="fr-media-pending__spin" size={18} aria-hidden />
            <span className="fr-media-pending__name">{p.name}</span>
          </div>
        ))}
      </>
    );
  },
});
