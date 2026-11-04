// Starting a recording (a dialog) and the recording itself (a floating bar and the camera bubble).
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Video, X } from 'lucide-react';
import { formatWalkthroughTime, MAX_WALKTHROUGH_MS, MAX_WALKTHROUGH_TITLE } from '@freero/shared';
import { usePointer, type PanelProps } from '@engine';
import { Button, Input, Modal, Spinner, Toggle } from '@ui';
import { START_ID } from './ids';
import { clearRecorderError, notePointer, startRecording, stopRecording, useRecorder } from './recorder';

import { t } from '../messages';
export function StartDialog({ editor }: PanelProps) {
  const rec = useRecorder();
  const [title, setTitle] = useState(`Walkthrough of ${editor.host.board.title || 'this board'}`.slice(0, MAX_WALKTHROUGH_TITLE));
  const [camera, setCamera] = useState(false);
  const close = () => {
    clearRecorderError();
    editor.closePanel(START_ID);
  };
  const start = async () => {
    const ok = await startRecording(editor, { title: title.trim() || t('walkthrough'), camera });
    if (ok) editor.closePanel(START_ID);
  };
  return (
    <Modal
      open
      onClose={close}
      title={t('recordAWalkthrough2')}
      description={t('talkPeopleThroughTheBoard')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" icon={camera ? Video : Mic} loading={rec.phase === 'starting'} onClick={() => void start()}>{t('startRecording')}</Button>
        </>
      }
    >
      <div className="fr-walkthrough-start">
        <Input label={t('title')} value={title} maxLength={MAX_WALKTHROUGH_TITLE} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <Toggle checked={camera} onChange={setCamera} label={t('showMyCameraInA')} />
        <p className="fr-walkthrough-start__note">{t('yourBrowserAsksForThe')}{camera ? t('andCamera') : ''}{' '}{t('firstUpTo')}{' '}{MAX_WALKTHROUGH_MS / 60000} minutes; stop any time.
        </p>
        {rec.error && (
          <p className="fr-walkthrough-start__error" role="alert">
            {rec.error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Mirrors a live stream into a <video> (the narrator sees themselves, mirrored like a mirror). */
function LiveBubble({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className="fr-walkthrough-bubble__video is-mirrored" autoPlay muted playsInline aria-label={t('yourCamera')} />;
}

function useElapsed(startedAt: number, running: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [running]);
  return running ? performance.now() - startedAt : 0;
}

/** While recording: where the pointer is goes into the timeline; the bar stops or cancels. */
export function RecordingOverlay(_: PanelProps) {
  const rec = useRecorder();
  const pointer = usePointer();
  const recording = rec.phase === 'recording';
  useEffect(() => {
    if (recording) notePointer(pointer);
  }, [recording, pointer]);
  const elapsed = useElapsed(rec.startedAt, recording);
  if (rec.phase === 'idle' || rec.phase === 'starting') return null;
  return (
    <>
      {recording && rec.camera && rec.stream && (
        <div className="fr-walkthrough-bubble is-recording" data-fr-occludes="" data-fr-interactive="">
          <LiveBubble stream={rec.stream} />
        </div>
      )}
      <div className="fr-walkthrough-bar is-recording" role="region" aria-label={t('recordingAWalkthrough')} data-fr-occludes="" data-fr-interactive="">
        {recording ? (
          <>
            <span className="fr-walkthrough-bar__rec" aria-hidden />
            <span className="fr-walkthrough-bar__time" aria-live="off">
              {formatWalkthroughTime(elapsed)}
              <span className="fr-walkthrough-bar__total"> / {formatWalkthroughTime(MAX_WALKTHROUGH_MS)}</span>
            </span>
            <span className="fr-walkthrough-bar__hint">{t('recordingYour')}{' '}{rec.camera ? t('voiceAndCamera') : 'voice'}{t('viewAndPointer')}</span>
            <Button size="sm" variant="primary" icon={Square} onClick={() => void stopRecording(true)}>{t('stopAndSave')}</Button>
            <Button size="sm" variant="ghost" icon={X} onClick={() => void stopRecording(false)}>{t('discard')}</Button>
          </>
        ) : (
          <>
            <Spinner size={16} />
            <span className="fr-walkthrough-bar__hint">{t('savingTheWalkthrough')}</span>
          </>
        )}
      </div>
    </>
  );
}
