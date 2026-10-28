import { useState } from 'react';
import { Download } from 'lucide-react';
import { defineFormat } from '@engine';
import { Spinner } from '@ui';
import { downloadBlockedReason, downloadItem, type Downloadable } from './lib/download';

/** One selected file card or video / audio item: download it. */
export default defineFormat({
  id: 'media.format',
  order: 50,
  appliesTo: (selection) => selection.length === 1 && (selection[0].type === 'file' || selection[0].type === 'media'),
  Component: ({ editor, selection }) => {
    const el = selection[0] as Downloadable;
    const [busy, setBusy] = useState(false);
    const blocked = downloadBlockedReason(editor);
    return (
      <div className="fr-media-format">
        <button
          type="button"
          className="fr-media-format__btn"
          disabled={busy || !el.src || !!blocked}
          title={blocked ?? undefined}
          onClick={async () => {
            setBusy(true);
            try {
              await downloadItem(editor, el);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner size={14} /> : <Download size={16} aria-hidden />}
          Download
        </button>
      </div>
    );
  },
});
