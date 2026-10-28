import { useState } from 'react';
import { MAX_REPORT_NOTE, REPORT_REASONS, type ReportReason } from '@freero/shared';
import { definePanel, type PanelProps } from '@engine';
import { Button, Modal, TextArea } from '@ui';
import { isReportTarget, REPORT_DIALOG, TARGET_NOUN } from './lib/target';
import './report.css';

function ReportDialog({ editor, props }: PanelProps) {
  const target = isReportTarget(props?.target) ? props.target : { kind: 'board' as const };
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => editor.closePanel(REPORT_DIALOG);

  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await editor.host.report({ target, reason, note: note.trim() });
      close();
      editor.host.notify('Thanks for your report. Freero’s moderators will review it.', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your report could not be sent. Try again.');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={`Report ${TARGET_NOUN[target.kind]}`}
      description="Tell Freero’s moderators what is wrong. The board’s owner isn’t told who reported it."
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={send} disabled={!reason} loading={busy}>
            Send report
          </Button>
        </>
      }
    >
      <fieldset className="fr-report__reasons">
        <legend className="fr-report__legend">What’s the problem?</legend>
        {REPORT_REASONS.map((r) => (
          <label key={r.id} className={`fr-report__reason${reason === r.id ? ' is-picked' : ''}`}>
            <input type="radio" name="fr-report-reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} />
            <span>{r.label}</span>
          </label>
        ))}
      </fieldset>
      <TextArea
        label="Details (optional)"
        value={note}
        maxLength={MAX_REPORT_NOTE}
        rows={3}
        placeholder="Anything that helps us understand, e.g. where on the board it is"
        onChange={(e) => setNote(e.target.value)}
      />
      {error && (
        <p className="fr-report__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

export default definePanel({
  id: REPORT_DIALOG,
  slot: 'dialog',
  order: 95,
  minRole: 'viewer',
  Component: ReportDialog,
});
