import { useState } from 'react';
import { MAX_REPORT_NOTE, REPORT_REASONS, type ReportReason } from '@freero/shared';
import { definePanel, type PanelProps } from '@engine';
import { Button, Input, Modal, TextArea } from '@ui';
import { isReportTarget, REPORT_DIALOG, TARGET_NOUN } from './lib/target';
import { t } from './messages';
import './report.css';

function ReportDialog({ editor, props }: PanelProps) {
  const target = isReportTarget(props?.target) ? props.target : { kind: 'board' as const };
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  // A visitor without an account has no inbox: an address (optional) is how they hear the outcome.
  const visitor = editor.host.board.signedIn === false;
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => editor.closePanel(REPORT_DIALOG);

  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await editor.host.report({ target, reason, note: note.trim(), ...(visitor && contact.trim() ? { contactEmail: contact.trim() } : {}) });
      close();
      editor.host.notify(t('thanksForYourReportFreero'), 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('yourReportCouldNotBe'));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={t('reportTargetNoun', { target_noun: TARGET_NOUN[target.kind] })}
      description={t('tellFreeroSModeratorsWhat')}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>{t('cancel')}</Button>
          <Button variant="primary" onClick={send} disabled={!reason} loading={busy}>{t('sendReport')}</Button>
        </>
      }
    >
      <fieldset className="fr-report__reasons">
        <legend className="fr-report__legend">{t('whatSTheProblem')}</legend>
        {REPORT_REASONS.map((r) => (
          <label key={r.id} className={`fr-report__reason${reason === r.id ? ' is-picked' : ''}`}>
            <input type="radio" name="fr-report-reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} />
            <span>{r.label}</span>
          </label>
        ))}
      </fieldset>
      <TextArea
        label={t('detailsOptional')}
        value={note}
        maxLength={MAX_REPORT_NOTE}
        rows={3}
        placeholder={t('anythingThatHelpsUsUnderstand')}
        onChange={(e) => setNote(e.target.value)}
      />
      {visitor && (
        <Input
          className="fr-report__contact"
          type="email"
          label={t('yourEmailOptional')}
          placeholder={t('toHearWhatWeDecided')}
          value={contact}
          maxLength={254}
          autoComplete="email"
          onChange={(e) => setContact(e.target.value)}
        />
      )}
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
