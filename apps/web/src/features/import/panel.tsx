// "Import…" (KAI-138, #116, #62): pick a file — or read a Miro board with your own Miro token — and
// afterwards the report of what could not be mapped. Dropping a file on the board does the same
// without the dialog; its toast opens the report here ("Details").
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FileInput, KeyRound } from 'lucide-react';
import { definePanel, type PanelProps } from '@engine';
import { Button, Input, Modal, SegmentedControl } from '@ui';
import { ImportError, type ImportReport } from './lib/common';
import { IMPORT_DIALOG, importFile, importMiro, summary } from './lib/insert';
import { t } from './messages';
import './import.css';

function ReportList({ report }: { report: ImportReport }) {
  return (
    <div className="fr-import__report">
      <p>{summary(report)}.</p>
      {report.skipped.length ? (
        <>
          <p className="fr-import__report-head">{t('notMappedExactly')}</p>
          <ul>
            {report.skipped.map((s) => (
              <li key={s.what}>
                <span>{s.what}</span>
                <span className="fr-import__count">{s.count}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>{t('everythingInTheFileHas')}</p>
      )}
      {report.notes?.length ? (
        <ul className="fr-import__notes">
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type Source = 'file' | 'miro';

function ImportDialog({ editor, props }: PanelProps) {
  // The import running now. Cancel, Esc or the dialog going away aborts it: a file or board still
  // being read is never placed afterwards, and the server stops copying a Miro board's pictures.
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const begin = () => {
    running.current?.abort();
    running.current = new AbortController();
    return running.current.signal;
  };
  const close = () => {
    running.current?.abort();
    editor.closePanel(IMPORT_DIALOG);
  };
  const [report, setReport] = useState<ImportReport | null>((props?.report as ImportReport | undefined) ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const miroOffered = !!editor.host.boardImport;
  const [source, setSource] = useState<Source>(props?.source === 'miro' && miroOffered ? 'miro' : 'file');
  const [board, setBoard] = useState('');
  const [token, setToken] = useState('');

  const done = (r: ImportReport) => {
    if (!r.skipped.length && !r.notes?.length) {
      editor.host.notify(summary(r), 'success');
      close();
    } else setReport(r);
  };
  const failed = (e: unknown) => setError(e instanceof ImportError || (e instanceof Error && source === 'miro') ? (e as Error).message : t('couldNotImportThatFile'));

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const signal = begin();
    setBusy(true);
    setError(null);
    try {
      done(await importFile(editor, file, undefined, signal));
    } catch (e) {
      if (!signal.aborted) failed(e);
    } finally {
      setBusy(false);
    }
  };

  const readMiro = async (e: FormEvent) => {
    e.preventDefault();
    if (!board.trim() || !token.trim()) return;
    const signal = begin();
    setBusy(true);
    setError(null);
    try {
      done(await importMiro(editor, board.trim(), token.trim(), undefined, signal));
      // The token is the person's: forgotten as soon as the board has been read.
      setToken('');
    } catch (err) {
      if (!signal.aborted) failed(err);
    } finally {
      setBusy(false);
    }
  };

  const footer = report ? (
    // Keyed: a new button for the report, so it doesn't fade from Cancel's colours into Done's.
    <Button key="done" variant="primary" onClick={close}>
      {t('done')}
    </Button>
  ) : source === 'miro' ? (
    <>
      <Button key="cancel" variant="secondary" onClick={close}>
        {t('cancel')}
      </Button>
      <Button key="import" variant="primary" type="submit" form="fr-import-miro" disabled={busy || !board.trim() || !token.trim()}>
        {busy ? t('importing') : t('importBoard')}
      </Button>
    </>
  ) : (
    <Button key="cancel" variant="secondary" onClick={close}>
      {t('cancel')}
    </Button>
  );

  return (
    <Modal
      open
      onClose={close}
      title={report ? t('importedFromSource', { source: report.source }) : source === 'miro' ? t('importAMiroBoard') : t('importAFile')}
      description={report ? undefined : source === 'miro' ? t('miroDescription') : t('shapesTextConnectorsFramesFreehand')}
      width={540}
      footer={footer}
    >
      {report ? (
        <ReportList report={report} />
      ) : (
        <div className="fr-import">
          {miroOffered ? (
            <SegmentedControl<Source>
              aria-label={t('importFrom')}
              value={source}
              onChange={(v) => {
                setSource(v);
                setError(null);
              }}
              options={[
                { value: 'file', label: t('fromAFile') },
                { value: 'miro', label: t('fromMiro') },
              ]}
            />
          ) : null}
          {source === 'file' ? (
            <>
              <label className={`fr-import__file${busy ? ' fr-import__file--busy' : ''}`}>
                <FileInput size={18} aria-hidden />
                <span>{busy ? t('importing') : t('chooseAFileToImport')}</span>
                <input type="file" disabled={busy} accept=".drawio,.dio,.xml,.excalidraw,.json,.vsdx,.vsdm,.pptx,.pptm,.ppsx,.potx,.csv" onChange={(e) => void pick(e.target.files?.[0])} />
              </label>
              <p className="fr-import__hint">{t('youCanAlsoDropThe')}</p>
              <p className="fr-import__hint">{t('otherWhiteboardExports')}</p>
            </>
          ) : (
            <form id="fr-import-miro" className="fr-import__miro" onSubmit={(e) => void readMiro(e)}>
              <Input label={t('miroBoardLink')} placeholder="https://miro.com/app/board/…" value={board} onChange={(e) => setBoard(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false} />
              <Input
                label={t('miroAccessToken')}
                type="password"
                icon={KeyRound}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                hint={t('miroTokenHint')}
              />
              <p className="fr-import__hint">{t('miroTokenSteps')}</p>
            </form>
          )}
          {error ? (
            <p className="fr-import__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

export default definePanel({ id: IMPORT_DIALOG, slot: 'dialog', order: 92, Component: ImportDialog });
