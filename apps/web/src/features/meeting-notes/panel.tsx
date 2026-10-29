// "Import meeting notes…": pick a summary or transcript file, or paste the text. Everything lands as
// one frame; one undo takes it back.
import { useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { LayoutError } from '@freero/shared';
import { definePanel, type PanelProps, type Point } from '@engine';
import { Button, Modal, TextArea, Toggle } from '@ui';
import { ACCEPT, DIALOG, importMeetingFile, layoutMeetingNotes, placeMeeting, summary } from './lib/insert';
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
      editor.host.notify(summary(await work()), 'success');
      close();
    } catch (e) {
      setError(e instanceof LayoutError ? e.message : 'Could not import these notes');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title="Import meeting notes"
      description="A summary (Markdown or text) or a transcript (.vtt, .srt) from your notes app becomes one frame: decisions, action items with owner and due date, and the other points. One undo takes it back."
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void run(() => placeMeeting(editor, layoutMeetingNotes({ text, speakers }), at))}>
            Import text
          </Button>
        </>
      }
    >
      <div className="fr-meeting-notes">
        <label className={`fr-meeting-notes__file${busy ? ' fr-meeting-notes__file--busy' : ''}`}>
          <NotebookPen size={18} aria-hidden />
          <span>{busy ? 'Importing…' : 'Choose a file (.md, .txt, .vtt, .srt)'}</span>
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
        <TextArea label="Or paste the notes" rows={8} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} placeholder={'# Weekly sync\n\n## Decisions\n- …\n\n## Action items\n- [ ] Sam to … by Friday'} />
        <Toggle checked={speakers} onChange={setSpeakers} size="sm" label="For transcripts, add who spoke and for how long" />
        <p className="fr-meeting-notes__hint">Dropping a .vtt or .srt file on the board imports it too.</p>
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
