// "Import draw.io or Excalidraw file…" (KAI-138): pick a file, and afterwards the report of what
// could not be mapped. Dropping a file on the board does the same without the dialog; its toast
// opens the report here ("Details").
import { useState } from 'react';
import { FileInput } from 'lucide-react';
import { definePanel, type PanelProps } from '@engine';
import { Button, Modal } from '@ui';
import { ImportError, type ImportReport } from './lib/common';
import { IMPORT_DIALOG, importFile, summary } from './lib/insert';
import './import.css';

function ReportList({ report }: { report: ImportReport }) {
  return (
    <div className="fr-import__report">
      <p>{summary(report)}.</p>
      {report.skipped.length ? (
        <>
          <p className="fr-import__report-head">Not mapped exactly:</p>
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
        <p>Everything in the file has a Freero counterpart.</p>
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
      setError(e instanceof ImportError ? e.message : 'Could not import that file');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={report ? `Imported from ${report.source}` : 'Import a diagram'}
      description={report ? undefined : 'Shapes, text, connectors, frames, freehand and images from a draw.io (.drawio) or Excalidraw (.excalidraw) file. One undo takes it all back.'}
      width={520}
      footer={
        <Button variant={report ? 'primary' : 'secondary'} onClick={close}>
          {report ? 'Done' : 'Cancel'}
        </Button>
      }
    >
      {report ? (
        <ReportList report={report} />
      ) : (
        <div className="fr-import">
          <label className={`fr-import__file${busy ? ' fr-import__file--busy' : ''}`}>
            <FileInput size={18} aria-hidden />
            <span>{busy ? 'Importing…' : 'Choose a .drawio or .excalidraw file'}</span>
            <input type="file" disabled={busy} accept=".drawio,.dio,.xml,.excalidraw,.json" onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
          <p className="fr-import__hint">You can also drop the file on the board, or paste a diagram copied from either app.</p>
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
