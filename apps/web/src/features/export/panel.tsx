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
import { t } from './messages';
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
  // Share of the picture drawn so far (big boards render in steps, the page answering in between).
  const [drawn, setDrawn] = useState<number | undefined>(undefined);
  const info = useMemo(() => scopeInfo(editor, scope), [editor, scope]);
  const boardEmpty = editor.getElements().length === 0;
  const size = info.rect ? outputSize(info.rect, format === 'svg' ? 1 : Number(scale)) : null;

  const run = async () => {
    setBusy(true);
    setDrawn(undefined);
    try {
      await exportImage(editor, { format, scale: Number(scale), background, scope, onProgress: (done, total) => setDrawn(total > 1 ? done / total : undefined) });
      close();
    } catch (err) {
      console.warn('Image export failed', err);
      editor.host.notify(t('exportFailedTryASmaller'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const empty = boardEmpty
    ? t('thisBoardIsEmptyAdd')
    : info.count === 0
      ? scope === 'selection'
        ? t('nothingIsSelectedSelectItems')
        : t('nothingIsVisibleRightNow')
      : null;

  return (
    <Modal
      open
      onClose={busy ? () => {} : close}
      title={t('exportBoardAsImage2')}
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>{t('cancel')}</Button>
          <Button variant="primary" icon={ImageDown} loading={busy} disabled={!!empty || busy} onClick={run}>{t('export')}</Button>
        </>
      }
    >
      <div className="fr-export">
        <Row label={t('format')}>
          <SegmentedControl
            aria-label={t('format')}
            value={format}
            onChange={setFormat}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPG' },
              { value: 'svg', label: 'SVG' },
            ]}
          />
        </Row>
        <Row label={t('scale')} hint={format === 'svg' ? t('svgIsVectorSoIt') : undefined}>
          {format === 'svg' ? (
            <span className="fr-export__muted">{t('notNeededForSvg')}</span>
          ) : (
            <SegmentedControl
              aria-label={t('scale')}
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
        <Row label={t('background')} hint={format === 'jpeg' ? t('jpgHasNoTransparencySo') : undefined}>
          <Toggle aria-label={t('includeBackground')} checked={background || format === 'jpeg'} disabled={format === 'jpeg'} onChange={setBackground} />
        </Row>
        <Row label={t('area')}>
          <SegmentedControl
            aria-label={t('area')}
            value={scope}
            onChange={setScope}
            options={[
              { value: 'board', label: t('wholeBoard') },
              { value: 'selection', label: t('selection') },
              { value: 'visible', label: t('visibleArea') },
            ]}
          />
        </Row>
        {empty ? (
          <p className="fr-export__empty">{empty}</p>
        ) : (
          <p className="fr-export__summary">
            {info.count} {info.count === 1 ? 'item' : 'items'}
            {size ? t('wHPx', { w: size.w.toLocaleString(), h: size.h.toLocaleString() }) : ''}
            {size?.capped ? t('reducedToTheMaximumSize') : ''}
          </p>
        )}
        {busy && (
          <Progress
            value={drawn}
            label={info.count > LARGE_BOARD ? t('renderingCountItemsLargeBoards', { count: info.count.toLocaleString() }) : t('rendering')}
          />
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
      editor.host.notify(t('pdfExportFailedTryFewer'), 'error');
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
      title={t('exportFramesAsPdf2')}
      description={frames.length ? t('eachFrameBecomesOnePage') : undefined}
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={cancel}>
            {busy ? t('stop') : t('cancel')}
          </Button>
          <Button variant="primary" icon={FileDown} loading={busy} disabled={!picked.length || busy} onClick={run}>
            {t('exportLengthPages', { length: picked.length })}
          </Button>
        </>
      }
    >
      {frames.length === 0 ? (
        <p className="fr-export__empty">{t('thisBoardHasNoFrames')}</p>
      ) : (
        <div className="fr-export">
          <div className="fr-export__framesHead">
            <span className="fr-export__label">{t('frames')}</span>
            <button
              type="button"
              className="fr-export__link"
              onClick={() => setChosen(picked.length === frames.length ? new Set() : new Set(frames.map((f) => f.id)))}
            >
              {picked.length === frames.length ? t('selectNone') : t('selectAll')}
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
                    {f.skip && <span className="fr-export__skipped">{' '}{t('skippedInTheDeck')}</span>}
                  </span>
                  <span className="fr-export__frameSize">
                    {Math.round(f.w)} × {Math.round(f.h)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Row label={t('pageSize')}>
            <SegmentedControl
              aria-label={t('pageSize')}
              value={pageSize}
              onChange={setPageSize}
              options={[
                { value: 'fit', label: t('fitToFrame') },
                { value: 'a4', label: 'A4 landscape' },
              ]}
            />
          </Row>
          {progress && (
            <Progress
              value={progress.total ? progress.done / progress.total : 0}
              label={t('renderingPageMinOfTotal', { min: Math.min(progress.done + 1, progress.total), total: progress.total })}
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
