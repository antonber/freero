// Captions for a walkthrough: typed by hand ("0:05 What we decided…" per line), or made by the
// board's AI provider when AI is on for this person here — the recording goes to that provider
// and nowhere else; without AI, there is no transcription at all.
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { formatWalkthroughTime, type Walkthrough } from '@freero/shared';
import type { PanelProps } from '@engine';
import { Button, Modal, Spinner, TextArea } from '@ui';
import { CAPTIONS_ID } from './ids';
import { updateWalkthrough, usePlayer } from './playback';
import { parseCaptionLines } from './timeline';

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong');
const asLines = (w: Walkthrough) => (w.transcript ?? []).map((c) => `${formatWalkthroughTime(c.start)} ${c.text}`).join('\n');

export function CaptionsDialog({ editor, props }: PanelProps) {
  const id = String(props?.id ?? '');
  const playing = usePlayer().walkthrough;
  const [w, setW] = useState<Walkthrough | null>(playing?.id === id ? playing : null);
  const [text, setText] = useState(w ? asLines(w) : '');
  const [ai, setAi] = useState<{ available: boolean; reason?: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'ai' | null>(null);
  const host = editor.host.walkthroughs;
  const close = () => editor.closePanel(CAPTIONS_ID);

  useEffect(() => {
    if (!host) return;
    if (!w)
      host.get(id).then(
        (x) => (setW(x), setText(asLines(x))),
        (e: unknown) => editor.host.notify(message(e), 'error'),
      );
    host.captionsStatus().then(setAi, () => setAi({ available: false, reason: 'AI captions aren’t available here.' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = (x: Walkthrough, note: string) => {
    updateWalkthrough(x);
    editor.host.notify(note, 'success');
    close();
  };
  const save = async () => {
    if (!host || !w) return;
    setBusy('save');
    try {
      done(await host.setCaptions(w.id, parseCaptionLines(text, w.durationMs)), text.trim() ? 'Captions saved' : 'Captions removed');
    } catch (e) {
      editor.host.notify(message(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const transcribe = async () => {
    if (!host || !w) return;
    setBusy('ai');
    try {
      done(await host.transcribe(w.id), 'Captions made from the recording');
    } catch (e) {
      editor.host.notify(message(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      width={520}
      title="Captions"
      description="Captions show while people watch, for anyone who can’t or won’t listen."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy === 'save'} disabled={!w || busy !== null} onClick={() => void save()}>
            Save captions
          </Button>
        </>
      }
    >
      {!w ? (
        <Spinner size={20} />
      ) : (
        <div className="fr-walkthrough-captions">
          <section className="fr-walkthrough-captions__ai">
            {ai === null ? (
              <Spinner size={16} />
            ) : ai.available ? (
              <>
                <Button size="sm" icon={Sparkles} loading={busy === 'ai'} disabled={busy !== null} onClick={() => void transcribe()}>
                  Make captions with AI
                </Button>
                <span>The recording is sent to this board’s AI provider, and nowhere else.</span>
              </>
            ) : (
              <span>AI captions aren’t available: {ai.reason}</span>
            )}
          </section>
          <TextArea
            label="Type or paste captions, one per line, starting with when it’s said"
            rows={8}
            value={text}
            placeholder={'0:00 Welcome to the roadmap\n0:12 First, what we shipped'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Modal>
  );
}
