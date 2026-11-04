// "Import meeting notes…": pick a summary or transcript file, or paste the text. Everything lands as
// one frame; one undo takes it back.
import { useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { LayoutError } from '@freero/shared';
import { definePanel, type PanelProps, type Point } from '@engine';
import { Button, Modal, TextArea, Toggle } from '@ui';
import { ACCEPT, announce, DIALOG, importMeetingFile, layoutMeetingNotes, placeMeeting } from './lib/insert';
import { t } from './messages';
import './meeting-notes.css';

const isPoint = (v: unknown): v is Point => !!v && typeof (v as Point).x === 'number' && typeof (v as Point).y === 'number';

function MeetingNotesDialog({ editor, props }: PanelProps) {
  const close = () => editor.closePanel(DIALOG);
  const at = isPoint(props?.at) ? props.at : undefined;
  const [text, setText] = useState('');
  const [speakers, setSpeakers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<ReturnType<typeof placeMeeting>> | ReturnType<typeof placeMeeting>) => {
    setBusy(true);
    setError(null);
    try {
      announce(editor, await work());
      close();
    } catch (e) {
      setError(e instanceof LayoutError ? e.message : t('couldNotImportTheseNotes'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={t('importMeetingNotes2')}
      description={t('aSummaryMarkdownOrText')}
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void run(() => placeMeeting(editor, layoutMeetingNotes({ text, speakers }), at))}>{t('importText')}</Button>
        </>
      }
    >
      <div className="fr-meeting-notes">
        <label className={`fr-meeting-notes__file${busy ? ' fr-meeting-notes__file--busy' : ''}`}>
          <NotebookPen size={18} aria-hidden />
          <span>{busy ? t('importing') : t('chooseAFileMdTxt')}</span>
          <input
            type="file"
            disabled={busy}
            accept={ACCEPT}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void run(() => importMeetingFile(editor, file, { speakers }, at));
            }}
          />
        </label>
        <TextArea label={t('orPasteTheNotes')} rows={8} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} placeholder={'# Weekly sync\n\n## Decisions\n- …\n\n## Action items\n- [ ] Sam to … by Friday'} />
        <Toggle checked={speakers} onChange={setSpeakers} size="sm" label={t('forTranscriptsAddWhoSpoke')} />
        <p className="fr-meeting-notes__hint">{t('droppingAVttOrSrt')}</p>
        {error ? (
          <p className="fr-meeting-notes__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export default definePanel({ id: DIALOG, slot: 'dialog', order: 93, Component: MeetingNotesDialog });
