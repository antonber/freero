// "Import a diagram file…" (KAI-138, #116): pick a file, and afterwards the report of what
// could not be mapped. Dropping a file on the board does the same without the dialog; its toast
// opens the report here ("Details").
import { useState } from 'react';
import { FileInput } from 'lucide-react';
import { definePanel, type PanelProps } from '@engine';
import { Button, Modal } from '@ui';
import { ImportError, type ImportReport } from './lib/common';
import { IMPORT_DIALOG, importFile, summary } from './lib/insert';
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
    </div>
  );
}

function ImportDialog({ editor, props }: PanelProps) {
  const close = () => editor.closePanel(IMPORT_DIALOG);
  const [report, setReport] = useState<ImportReport | null>((props?.report as ImportReport | undefined) ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await importFile(editor, file);
      if (!r.skipped.length) {
        editor.host.notify(summary(r), 'success');
        close();
      } else setReport(r);
    } catch (e) {
      setError(e instanceof ImportError ? e.message : t('couldNotImportThatFile'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={report ? t('importedFromSource', { source: report.source }) : t('importAFile')}
      description={report ? undefined : t('shapesTextConnectorsFramesFreehand')}
      width={520}
      footer={
        // Keyed: a new button for the report, so it doesn't fade from Cancel's colours into Done's.
        <Button key={report ? 'done' : 'cancel'} variant={report ? 'primary' : 'secondary'} onClick={close}>
          {report ? t('done') : t('cancel')}
        </Button>
      }
    >
      {report ? (
        <ReportList report={report} />
      ) : (
        <div className="fr-import">
          <label className={`fr-import__file${busy ? ' fr-import__file--busy' : ''}`}>
            <FileInput size={18} aria-hidden />
            <span>{busy ? t('importing') : t('chooseADrawioExcalidrawVsdx')}</span>
            <input type="file" disabled={busy} accept=".drawio,.dio,.xml,.excalidraw,.json,.vsdx,.vsdm,.pptx,.pptm,.ppsx,.potx" onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
          <p className="fr-import__hint">{t('youCanAlsoDropThe')}</p>
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
