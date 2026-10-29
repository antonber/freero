import { useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, ImageDown } from 'lucide-react';
import { definePanel, type Editor, type PanelProps } from '@engine';
import { Button, Modal, SegmentedControl, Toggle } from '@ui';
import {
  LARGE_BOARD,
  boardFrames,
  exportImage,
  missingImages,
  outputSize,
  pdfScale,
  scopeInfo,
  type ImageFormat,
  type ImageScope,
} from './lib/exporters';
import { exportFileName } from './lib/files';
import { buildFramesPdf, framesInPageOrder, type PageSize } from './lib/pdf';
import { EXPORT_DIALOG, type ExportKind } from './lib/dialog';
import './export.css';


function Progress({ label, value }: { label: string; value?: number }) {
  return (
    <div className="fr-export__progress" role="status" aria-live="polite">
      <div className="fr-export__bar">
        <span className={value === undefined ? 'is-indeterminate' : undefined} style={value === undefined ? undefined : { width: `${Math.round(value * 100)}%` }} />
      </div>
      <span>{label}</span>
    </div>
  );
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="fr-export__row">
      <div className="fr-export__label">{label}</div>
      <div className="fr-export__control">
        {children}
        {hint ? <div className="fr-export__hint">{hint}</div> : null}
      </div>
    </div>
  );
}

function ImageDialog({ editor }: { editor: Editor }) {
  const close = () => editor.closePanel(EXPORT_DIALOG);
  const [format, setFormat] = useState<ImageFormat>('png');
  const [scale, setScale] = useState<'1' | '2' | '3'>('2');
  const [background, setBackground] = useState(true);
  const [scope, setScope] = useState<ImageScope>(() => (editor.getSelection().length ? 'selection' : 'board'));
  const [busy, setBusy] = useState(false);
  const info = useMemo(() => scopeInfo(editor, scope), [editor, scope]);
  const boardEmpty = editor.getElements().length === 0;
  const size = info.rect ? outputSize(info.rect, format === 'svg' ? 1 : Number(scale)) : null;

  const run = async () => {
    setBusy(true);
    try {
      await exportImage(editor, { format, scale: Number(scale), background, scope });
      close();
    } catch (err) {
      console.warn('Image export failed', err);
      editor.host.notify('Export failed. Try a smaller scale or area.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const empty = boardEmpty
    ? 'This board is empty. Add something first, then export it.'
    : info.count === 0
      ? scope === 'selection'
        ? 'Nothing is selected. Select items on the board or pick another scope.'
        : 'Nothing is visible right now. Pan to some content or export the whole board.'
      : null;

  return (
    <Modal
      open
      onClose={busy ? () => {} : close}
      title="Export board as image"
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon={ImageDown} loading={busy} disabled={!!empty || busy} onClick={run}>
            Export
          </Button>
        </>
      }
    >
      <div className="fr-export">
        <Row label="Format">
          <SegmentedControl
            aria-label="Format"
            value={format}
            onChange={setFormat}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPG' },
              { value: 'svg', label: 'SVG' },
            ]}
          />
        </Row>
        <Row label="Scale" hint={format === 'svg' ? 'SVG is vector, so it stays sharp at any size.' : undefined}>
          {format === 'svg' ? (
            <span className="fr-export__muted">Not needed for SVG</span>
          ) : (
            <SegmentedControl
              aria-label="Scale"
              value={scale}
              onChange={setScale}
              options={[
                { value: '1', label: '1×' },
                { value: '2', label: '2×' },
                { value: '3', label: '3×' },
              ]}
            />
          )}
        </Row>
        <Row label="Background" hint={format === 'jpeg' ? 'JPG has no transparency, so the board background is always included.' : undefined}>
          <Toggle aria-label="Include background" checked={background || format === 'jpeg'} disabled={format === 'jpeg'} onChange={setBackground} />
        </Row>
        <Row label="Area">
          <SegmentedControl
            aria-label="Area"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'board', label: 'Whole board' },
              { value: 'selection', label: 'Selection' },
              { value: 'visible', label: 'Visible area' },
            ]}
          />
        </Row>
        {empty ? (
          <p className="fr-export__empty">{empty}</p>
        ) : (
          <p className="fr-export__summary">
            {info.count} {info.count === 1 ? 'item' : 'items'}
            {size ? ` · ${size.w.toLocaleString()} × ${size.h.toLocaleString()} px` : ''}
            {size?.capped ? ' (reduced to the maximum size)' : ''}
          </p>
        )}
        {busy && (
          <Progress label={info.count > LARGE_BOARD ? `Rendering ${info.count.toLocaleString()} items. Large boards take a few seconds…` : 'Rendering…'} />
        )}
      </div>
    </Modal>
  );
}

function PdfDialog({ editor }: { editor: Editor }) {
  const close = () => editor.closePanel(EXPORT_DIALOG);
  const frames = useMemo(() => framesInPageOrder(boardFrames(editor)), [editor]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(frames.filter((f) => !f.skip).map((f) => f.id)));
  const [pageSize, setPageSize] = useState<PageSize>('fit');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const busy = progress !== null;
  const picked = frames.filter((f) => chosen.has(f.id));
  const toggle = (id: string) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const run = async () => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress({ done: 0, total: picked.length });
    const missing = missingImages(editor);
    try {
      const pdf = await buildFramesPdf(picked, {
        pageSize,
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress({ done, total }),
        render: (f) =>
          editor.renderToDataUrl({
            rect: { x: f.x, y: f.y, w: f.w, h: f.h },
            padding: 0,
            format: 'jpeg',
            scale: pdfScale(f),
            onMissingImages: missing.onMissingImages,
          }),
      });
      if (pdf && !ctrl.signal.aborted) {
        pdf.save(exportFileName(editor.host.board.title, 'pdf', picked.length === 1 ? picked[0].title : 'frames'));
        editor.host.reportExport?.('pdf');
        missing.report();
        close();
      }
    } catch (err) {
      console.warn('PDF export failed', err);
      editor.host.notify('PDF export failed. Try fewer frames or the A4 page size.', 'error');
    } finally {
      if (abort.current === ctrl) abort.current = null;
      setProgress(null);
    }
  };

  const cancel = () => {
    if (abort.current) abort.current.abort();
    else close();
  };

  return (
    <Modal
      open
      onClose={cancel}
      title="Export frames as PDF"
      description={frames.length ? 'Each frame becomes one page, in presentation order.' : undefined}
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={cancel}>
            {busy ? 'Stop' : 'Cancel'}
          </Button>
          <Button variant="primary" icon={FileDown} loading={busy} disabled={!picked.length || busy} onClick={run}>
            {picked.length > 1 ? `Export ${picked.length} pages` : 'Export'}
          </Button>
        </>
      }
    >
      {frames.length === 0 ? (
        <p className="fr-export__empty">
          This board has no frames yet. Add a frame around the content you want on each page, then come back here. To export
          everything as one picture, use “Export board as image”.
        </p>
      ) : (
        <div className="fr-export">
          <div className="fr-export__framesHead">
            <span className="fr-export__label">Frames</span>
            <button
              type="button"
              className="fr-export__link"
              onClick={() => setChosen(picked.length === frames.length ? new Set() : new Set(frames.map((f) => f.id)))}
            >
              {picked.length === frames.length ? 'Select none' : 'Select all'}
            </button>
          </div>
          <ul className="fr-export__frames">
            {frames.map((f, i) => (
              <li key={f.id}>
                <label className="fr-export__frame">
                  <input type="checkbox" checked={chosen.has(f.id)} onChange={() => toggle(f.id)} disabled={busy} />
                  <span className="fr-export__frameNum">{i + 1}</span>
                  <span className="fr-export__frameTitle">
                    {f.title}
                    {f.skip && <span className="fr-export__skipped"> · skipped in the deck</span>}
                  </span>
                  <span className="fr-export__frameSize">
                    {Math.round(f.w)} × {Math.round(f.h)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Row label="Page size">
            <SegmentedControl
              aria-label="Page size"
              value={pageSize}
              onChange={setPageSize}
              options={[
                { value: 'fit', label: 'Fit to frame' },
                { value: 'a4', label: 'A4 landscape' },
              ]}
            />
          </Row>
          {progress && (
            <Progress
              value={progress.total ? progress.done / progress.total : 0}
              label={`Rendering page ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`}
            />
          )}
        </div>
      )}
    </Modal>
  );
}

function ExportDialog({ editor, props }: PanelProps) {
  return (props?.kind as ExportKind | undefined) === 'pdf' ? <PdfDialog editor={editor} /> : <ImageDialog editor={editor} />;
}

export default definePanel({
  id: EXPORT_DIALOG,
  slot: 'dialog',
  order: 90,
  minRole: 'viewer',
  Component: ExportDialog,
});
