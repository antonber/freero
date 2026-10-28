import { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import type { PdfElement } from '@freero/shared';
import { defineFormat } from '@engine';
import { Spinner } from '@ui';
import { placeAllPages } from './lib/actions';

/** One selected PDF: lay all its pages out as images. */
export default defineFormat({
  id: 'pdf.format',
  order: 50,
  appliesTo: (selection) => selection.length === 1 && selection[0].type === 'pdf',
  Component: ({ editor, selection }) => {
    const el = selection[0] as PdfElement;
    const [busy, setBusy] = useState(false);
    return (
      <div className="fr-pdf-format">
        <button
          type="button"
          className="fr-pdf-format__btn"
          disabled={busy || !el.src}
          onClick={async () => {
            setBusy(true);
            try {
              await placeAllPages(editor, el.id);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner size={14} /> : <LayoutGrid size={16} aria-hidden />}
          Place all pages
        </button>
      </div>
    );
  },
});
