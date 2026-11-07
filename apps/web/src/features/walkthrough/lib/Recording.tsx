// Starting a recording (a dialog) and the recording itself (a floating bar and the camera bubble).
import { useEffect, useMemo, useRef, useState } from 'react';
import { LogOut, Mic, Square, UserPlus, Video, X } from 'lucide-react';
import { formatWalkthroughTime, MAX_WALKTHROUGH_MS, MAX_WALKTHROUGH_TITLE } from '@freero/shared';
import { usePeers, usePointer, type PanelProps } from '@engine';
import { Avatar, Button, IconButton, Input, Menu, Modal, Spinner, Toggle } from '@ui';
import { START_ID } from './ids';
import { clearRecorderError, endRecordingWithBoard, followHost, joinRecording, notePointer, recordingOf, setInvited, startRecording, stopRecording, useRecorder, type GroupState, type RecordingPresence } from './recorder';

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
        <p className="fr-walkthrough-start__note">{t('yourBrowserAsksForThe')}{camera ? t('andCamera') : ''}{' '}{t('firstUpTo')}{' '}{MAX_WALKTHROUGH_MS / 60000}{' '}{t('minutesStopAnyTime')}</p>
        <p className="fr-walkthrough-start__note">{t('inviteOthersWhileRecording')}</p>
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

/** People on the board right now (one entry per person, not per tab), without me. */
function usePeopleHere(editor: PanelProps['editor']) {
  const peers = usePeers();
  return useMemo(() => {
    const seen = new Map<string, { id: string; name: string; color: string; recording: RecordingPresence | null }>();
    for (const p of peers) {
      if (p.agent || p.user.id === editor.user.id) continue;
      const rec = recordingOf(p);
      const prev = seen.get(p.user.id);
      if (!prev || (!prev.recording && rec)) seen.set(p.user.id, { id: p.user.id, name: p.user.name, color: p.user.color, recording: rec });
    }
    return [...seen.values()];
  }, [peers, editor]);
}

/** #128: the host invites people on the board into the recording; who joined shows beside it. */
function Presenters({ editor, group }: { editor: PanelProps['editor']; group: GroupState }) {
  const here = usePeopleHere(editor);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const joined = here.filter((p) => p.recording?.session === group.session && !p.recording.host);
  const others = here.filter((p) => !joined.includes(p));
  return (
    <>
      {joined.length > 0 && (
        <span className="fr-walkthrough-bar__presenters" aria-label={t('recordingWithNames', { names: joined.map((p) => p.name).join(', ') })}>
          {joined.map((p) => (
            <Avatar key={p.id} name={p.name} color={p.color} size={24} />
          ))}
        </span>
      )}
      <IconButton ref={anchor} icon={UserPlus} label={t('invitePresenters')} active={open} onClick={() => setOpen((o) => !o)} />
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor.current}
        side="top"
        items={
          others.length
            ? [
                { heading: t('inviteToPresentWithYou') },
                ...others.map((p) => ({
                  id: p.id,
                  label: p.name,
                  checked: group.invited.includes(p.id),
                  onSelect: () => setInvited(p.id, !group.invited.includes(p.id)),
                })),
              ]
            : [{ id: 'nobody', label: t('nobodyElseIsOnThe'), disabled: true, onSelect: () => undefined }]
        }
      />
    </>
  );
}

/** #128: someone recording invited me: join with my microphone (and camera), or not now. */
function JoinPrompt({ editor }: { editor: PanelProps['editor'] }) {
  const here = usePeopleHere(editor);
  const rec = useRecorder();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [joining, setJoining] = useState(false);
  const host = here.find((p) => p.recording?.host && !p.recording.ended && p.recording.invited?.includes(editor.user.id) && p.recording.session !== dismissed);
  if (!host?.recording || rec.phase !== 'idle' || !editor.can('editor')) return null;
  const presence = host.recording;
  const join = async () => {
    setJoining(true);
    const ok = await joinRecording(editor, { userId: host.id, name: host.name, presence }, { camera });
    setJoining(false);
    if (!ok) setDismissed(presence.session);
  };
  return (
    <div className="fr-walkthrough-invite" role="dialog" aria-label={t('joinTheRecording')} data-fr-occludes="" data-fr-interactive="">
      <Avatar name={host.name} color={host.color} size={32} />
      <div className="fr-walkthrough-invite__body">
        <p className="fr-walkthrough-invite__text">{t('nameInvitesYouToPresent', { name: host.name, title: presence.title })}</p>
        <p className="fr-walkthrough-invite__note">{t('joinRecordsYourOwnVoice')}</p>
        <Toggle checked={camera} onChange={setCamera} label={t('showMyCameraInA')} size="sm" />
        {rec.error && (
          <p className="fr-walkthrough-start__error" role="alert">
            {rec.error}
          </p>
        )}
        <div className="fr-walkthrough-invite__actions">
          <Button size="sm" variant="ghost" onClick={() => (clearRecorderError(), setDismissed(presence.session))}>{t('notNow')}</Button>
          <Button size="sm" variant="primary" icon={camera ? Video : Mic} loading={joining} onClick={() => void join()}>{t('join')}</Button>
        </div>
      </div>
    </div>
  );
}

/** While recording: where the pointer is goes into the timeline; the bar stops or cancels. */
export function RecordingOverlay({ editor }: PanelProps) {
  const rec = useRecorder();
  const pointer = usePointer();
  const peers = usePeers();
  const recording = rec.phase === 'recording';
  // This overlay lives exactly as long as the board: leaving it ends the recording made on it.
  useEffect(() => () => endRecordingWithBoard(editor), [editor]);
  useEffect(() => {
    if (recording) notePointer(pointer);
  }, [recording, pointer]);
  // A guest stops with their host (also checked on a clock: a host whose tab closed sends nothing).
  const guest = recording && rec.group?.role === 'guest';
  useEffect(() => {
    if (guest) followHost(peers);
  }, [guest, peers]);
  useEffect(() => {
    if (!guest) return;
    const id = setInterval(() => followHost(editor.getPeers()), 1000);
    return () => clearInterval(id);
  }, [guest, editor]);
  const elapsed = useElapsed(rec.startedAt, recording);
  if (rec.phase === 'idle' || rec.phase === 'starting') return <JoinPrompt editor={editor} />;
  const group = rec.group;
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
              {formatWalkthroughTime(elapsed + (group?.offsetMs ?? 0))}
              <span className="fr-walkthrough-bar__total"> / {formatWalkthroughTime(MAX_WALKTHROUGH_MS)}</span>
            </span>
            {group?.role === 'guest' ? (
              <>
                <span className="fr-walkthrough-bar__hint">{t('presentingWithName', { name: group.hostName })}</span>
                <Button size="sm" variant="primary" icon={LogOut} onClick={() => void stopRecording(true)}>{t('leaveAndKeepMyPart')}</Button>
              </>
            ) : (
              <>
                <span className="fr-walkthrough-bar__hint">{t('recordingYour')}{' '}{rec.camera ? t('voiceAndCamera') : 'voice'}{t('viewAndPointer')}</span>
                {group && <Presenters editor={editor} group={group} />}
                <Button size="sm" variant="primary" icon={Square} onClick={() => void stopRecording(true)}>{t('stopAndSave')}</Button>
                <Button size="sm" variant="ghost" icon={X} onClick={() => void stopRecording(false)}>{t('discard')}</Button>
              </>
            )}
          </>
        ) : (
          <>
            <Spinner size={16} />
            <span className="fr-walkthrough-bar__hint">{group?.role === 'guest' ? t('savingYourPart') : t('savingTheWalkthrough')}</span>
          </>
        )}
      </div>
    </>
  );
}
