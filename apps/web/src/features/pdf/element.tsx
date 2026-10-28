import { memo, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import type { PdfElement } from '@freero/shared';
import { defineElement, useCanEdit, useEditor, type ElementRenderProps, type NewElement } from '@engine';
import { FOOT_H, ITEM_W } from './lib/layout';
import { isPdfFile, insertPdf, turnPage } from './lib/actions';
import { openDocument, pageSize, rasterScale, renderPage, type Raster } from './lib/render';
import './pdf.css';

/** Below this zoom a page is a few px tall: show the paper, skip rendering. */
const LOD_ZOOM = 0.08;

type View = { state: 'loading' } | { state: 'ready'; raster: Raster } | { state: 'failed' };

/**
 * Renders the shown page at the current (quantized) zoom: zooming in re-renders it sharper, and
 * every raster is cached, so paging back or zooming back costs nothing.
 */
function usePageRaster(src: string, page: number, areaW: number, zoom: number, active: boolean): View {
  const [view, setView] = useState<View>({ state: 'loading' });
  useEffect(() => {
    if (!active) return;
    let alive = true;
    (async () => {
      try {
        const doc = await openDocument(src);
        const size = await pageSize(doc, Math.min(page, doc.numPages));
        const scale = rasterScale(size.w, areaW * zoom, window.devicePixelRatio || 1);
        const raster = await renderPage(src, Math.min(page, doc.numPages), scale);
        if (alive) setView({ state: 'ready', raster });
      } catch {
        if (alive) setView({ state: 'failed' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [src, page, areaW, zoom, active]);
  return view;
}

const PdfView = memo(function PdfView({ element: el, selected, zoom }: ElementRenderProps<PdfElement>) {
  const editor = useEditor();
  const canEdit = useCanEdit();
  // Viewers page through on their own; editors turn the page for everyone (it's board content).
  const [localPage, setLocalPage] = useState<number | null>(null);
  const page = canEdit ? el.page : (localPage ?? el.page);
  const areaH = Math.max(1, el.h - FOOT_H);
  const view = usePageRaster(el.src, page, el.w, zoom, zoom >= LOD_ZOOM);
  const count = el.pageCount;

  const go = (delta: number) => {
    if (canEdit && !el.locked) turnPage(editor, el.id, delta);
    else setLocalPage(Math.max(1, Math.min(count || 1, page + delta)));
  };
  const nav = (delta: number, label: string, Icon: typeof ChevronLeft, disabled: boolean) => (
    <button
      type="button"
      className="fr-pdf__nav"
      data-fr-interactive=""
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => go(delta)}
    >
      <Icon size={18} aria-hidden />
    </button>
  );

  return (
    <div className={`fr-pdf${selected ? ' is-selected' : ''}`}>
      <div className="fr-pdf__page" style={{ height: areaH }}>
        {view.state === 'ready' ? (
          <img className="fr-pdf__img" src={view.raster.url} alt={`${el.name}, page ${page}`} draggable={false} />
        ) : (
          <div className="fr-pdf__placeholder">
            <FileText size={Math.min(48, el.w / 6)} strokeWidth={1.4} aria-hidden />
            {view.state === 'failed' && <span>Couldn't open this PDF</span>}
          </div>
        )}
      </div>
      <div className="fr-pdf__foot" style={{ height: FOOT_H }}>
        <span className="fr-pdf__name" title={el.name}>
          {el.name || 'Document'}
        </span>
        {count > 1 && (
          <span className="fr-pdf__pager">
            {nav(-1, 'Previous page', ChevronLeft, page <= 1)}
            <span className="fr-pdf__num">
              {page} / {count}
            </span>
            {nav(1, 'Next page', ChevronRight, page >= count)}
          </span>
        )}
      </div>
    </div>
  );
});

export default defineElement({
  type: 'pdf',
  label: { one: 'PDF', many: 'PDFs' },
  icon: FileText,
  resize: 'aspect',
  minSize: { w: 120, h: 120 },
  defaults: (): Omit<NewElement<'pdf'>, 'x' | 'y'> => ({
    type: 'pdf',
    w: ITEM_W,
    h: Math.round((ITEM_W * 11) / 8.5) + FOOT_H,
    src: '',
    name: 'Document',
    page: 1,
    pageCount: 0,
  }),
  Component: PdfView,
  toPlainText: (el) => el.name,
  // PageUp / PageDown page through the selected document.
  keys: [{ shortcuts: ['pagedown', 'pageup'], label: 'Next / previous page of a document' }],
  onKeyDown(e, { editor, selection }) {
    if (selection.length !== 1 || selection[0].type !== 'pdf' || !editor.can('editor')) return false;
    if (e.key === 'PageDown' || e.key === 'PageUp') {
      turnPage(editor, selection[0].id, e.key === 'PageDown' ? 1 : -1);
      return true;
    }
    return false;
  },
  // Dropped or pasted PDF files become document items (one per file).
  importPriority: 15,
  importData(editor, data, at) {
    const pdfs = data.files.filter(isPdfFile);
    if (!pdfs.length) return false;
    void (async () => {
      let i = 0;
      for (const f of pdfs) {
        // Beside the rest of a mixed drop (KAI-204), else the first on the drop point.
        await insertPdf(editor, f, i++ || data.alongside ? undefined : at, at);
      }
    })();
    return pdfs;
  },
});
