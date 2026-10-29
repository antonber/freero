// Watching a walkthrough: the recording plays while the LIVE board follows the narrator's view —
// the camera is set from the recording's own clock every frame, so the view can never drift from
// the voice. The viewer's own pan or zoom takes the camera back (the bar offers "Back to their
// view"); pausing leaves the camera alone; playing again returns to the recorded path.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Captions, CaptionsOff, Download, Flag, LocateFixed, MessageSquareText, Pause, Play, Subtitles, X } from 'lucide-react';
import { formatWalkthroughTime, WALKTHROUGHS_COLLECTION, type Walkthrough, type WalkthroughSummary } from '@freero/shared';
import { useCamera, useCollection, usePeople, type Editor, type PanelProps } from '@engine';
import { Avatar, IconButton, Spinner } from '@ui';
import { Comments, useWalkthroughComments } from './Comments';
import { CAPTIONS_ID } from './ids';
import { closeWalkthrough, usePlayer } from './playback';
import { cameraShowing, cueAt, pointerAt, viewAt } from './timeline';

const STEP_MS = 5000;

export function PlayerOverlay({ editor }: PanelProps) {
  const p = usePlayer();
  if (p.walkthrough) return <Player key={`${p.walkthrough.id}:${p.session}`} editor={editor} w={p.walkthrough} startAt={p.startAt} />;
  if (!p.loading) return null;
  return (
    <div className="fr-walkthrough-bar" role="status" data-fr-occludes="">
      <Spinner size={16} />
      <span className="fr-walkthrough-bar__hint">Opening the walkthrough…</span>
    </div>
  );
}

const canManage = (editor: Editor, w: Walkthrough) => w.authorId === editor.user.id || editor.can('editor');

function Player({ editor, w, startAt }: { editor: Editor; w: Walkthrough; startAt: number }) {
  const media = useRef<HTMLMediaElement | null>(null);
  const [t, setT] = useState(startAt);
  const [playing, setPlaying] = useState(false);
  const [following, setFollowingState] = useState(true);
  const followingRef = useRef(true);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [showComments, setShowComments] = useState(false);
  const [problem, setProblem] = useState<string | null>(w.mediaRemoved ? 'Freero’s moderators removed this recording.' : null);
  const counted = useRef(false);
  const lastApplied = useRef<number | null>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const people = usePeople(w.authorId ? [w.authorId] : []);
  const author = (w.authorId && people[w.authorId]) || null;
  const summary = new Map(useCollection<WalkthroughSummary>(WALKTHROUGHS_COLLECTION)).get(w.id);
  const comments = useWalkthroughComments(editor, w.id, summary?.comments ?? w.comments);
  useCamera(); // the narrator's pointer moves on screen with the camera

  const setFollowing = (on: boolean) => {
    followingRef.current = on;
    setFollowingState(on);
  };

  /** Puts the camera where the narrator looked at `ms` (while following). */
  const apply = useCallback(
    (ms: number, force = false) => {
      if (!followingRef.current) return;
      if (!force && lastApplied.current !== null && Math.abs(ms - lastApplied.current) < 1) return;
      lastApplied.current = ms;
      const r = viewAt(w.timeline, ms);
      if (r) editor.setCamera(cameraShowing(r, editor.getViewportSize()));
    },
    [editor, w.timeline],
  );

  // The viewer's own pan / zoom takes the camera back from the recording.
  useEffect(() => editor.on('camera-user', () => setFollowing(false)), [editor]);

  // The clock: the recording's own position, every frame while it plays.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = media.current;
      if (el && !el.paused) {
        const ms = Math.min(w.durationMs, el.currentTime * 1000);
        setT(ms);
        apply(ms);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [apply, w.durationMs]);

  useEffect(() => {
    if (editor.getFollowing() && !editor.getFollowing()?.locked) editor.follow(null);
    apply(startAt, true);
    playButton.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seek = (ms: number) => {
    const to = Math.max(0, Math.min(w.durationMs, ms));
    if (media.current) media.current.currentTime = to / 1000;
    setT(to);
    apply(to, true);
  };
  const play = async () => {
    const el = media.current;
    if (!el || problem) return;
    if (!followingRef.current) setFollowing(true);
    if (t >= w.durationMs - 100) seek(0);
    else apply(t, true);
    try {
      await el.play();
    } catch {
      setProblem('The recording can’t be played in this browser.');
      return;
    }
    if (!counted.current) {
      counted.current = true;
      void editor.host.walkthroughs?.viewed(w.id).catch(() => undefined);
    }
  };
  const pause = () => media.current?.pause();
  const toggle = () => (playing ? pause() : void play());
  const backToView = () => {
    setFollowing(true);
    apply(t, true);
  };
  const close = () => {
    media.current?.pause();
    closeWalkthrough();
  };

  // MediaRecorder's WebM files don't say how long they are: asking for the very end makes the
  // browser find out, then we go to where playback starts.
  const onLoadedMetadata = () => {
    const el = media.current;
    if (!el) return;
    if (Number.isFinite(el.duration)) {
      el.currentTime = startAt / 1000;
      return;
    }
    const back = () => {
      el.removeEventListener('timeupdate', back);
      el.currentTime = startAt / 1000;
    };
    el.addEventListener('timeupdate', back);
    el.currentTime = 1e101;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('textarea, input:not([type="range"]), [contenteditable="true"]')) return;
    const range = target instanceof HTMLInputElement && target.type === 'range';
    const k = e.key.toLowerCase();
    let handled = true;
    if (k === ' ' || k === 'k') toggle();
    else if (!range && (k === 'arrowleft' || k === 'j')) seek(t - (k === 'j' ? 2 * STEP_MS : STEP_MS));
    else if (!range && (k === 'arrowright' || k === 'l')) seek(t + (k === 'l' ? 2 * STEP_MS : STEP_MS));
    else if (k === 'home') seek(0);
    else if (k === 'end') seek(w.durationMs);
    else if (k === 'c' && w.transcript?.length) setCaptionsOn((on) => !on);
    else if (k === 'f') backToView();
    else if (k === 'escape') close();
    else handled = false;
    // Never on to the board's own shortcuts underneath.
    e.stopPropagation();
    if (handled) e.preventDefault();
  };

  const cue = captionsOn ? cueAt(w.transcript, t) : null;
  const pointer = pointerAt(w.timeline, t);
  const at = pointer ? editor.worldToScreen(pointer) : null;
  const name = w.author?.name ?? 'Narrator';
  const color = author?.color ?? '#5b3ff0';
  const hasCaptions = !!w.transcript?.length;
  const markers = comments.list ?? [];

  return (
    <>
      {at && (
        <div className="fr-walkthrough-pointer" style={{ transform: `translate(${at.x}px, ${at.y}px)`, ['--fr-walkthrough-color' as string]: color }} aria-hidden>
          <span className="fr-walkthrough-pointer__dot" />
          <span className="fr-walkthrough-pointer__name">{name}</span>
        </div>
      )}

      <div className={`fr-walkthrough-bubble${playing ? ' is-speaking' : ''}`} style={{ ['--fr-walkthrough-color' as string]: color }} data-fr-occludes="">
        {w.media === 'video' ? (
          <video
            ref={(el) => void (media.current = el)}
            className="fr-walkthrough-bubble__video"
            src={problem ? undefined : w.mediaUrl}
            preload="metadata"
            playsInline
            onLoadedMetadata={onLoadedMetadata}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setT(w.durationMs);
            }}
            onError={() => setProblem((p) => p ?? 'The recording is gone or can’t be played.')}
            aria-label={`${name}’s camera`}
          />
        ) : (
          <>
            <Avatar name={name} color={color} src={author?.avatarUrl ?? null} size={72} />
            <audio
              ref={(el) => void (media.current = el)}
              src={problem ? undefined : w.mediaUrl}
              preload="metadata"
              onLoadedMetadata={onLoadedMetadata}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                setPlaying(false);
                setT(w.durationMs);
              }}
              onError={() => setProblem((p) => p ?? 'The recording is gone or can’t be played.')}
            />
          </>
        )}
      </div>

      {cue && (
        <div className="fr-walkthrough-caption" lang="">
          {cue.text}
        </div>
      )}

      {showComments && <Comments editor={editor} w={w} t={t} state={comments} onSeek={seek} onClose={() => setShowComments(false)} />}

      <div className="fr-walkthrough-bar is-playing" role="region" aria-label={`Walkthrough: ${w.title}`} onKeyDown={onKeyDown} data-fr-occludes="">
        <IconButton ref={playButton} icon={playing ? Pause : Play} label={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={toggle} disabled={!!problem} />
        <span className="fr-walkthrough-bar__time">{formatWalkthroughTime(t)}</span>
        <div className="fr-walkthrough-bar__track">
          <input
            type="range"
            className="fr-walkthrough-bar__range"
            min={0}
            max={w.durationMs}
            step={250}
            value={Math.round(t)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Position in the walkthrough"
            aria-valuetext={`${formatWalkthroughTime(t)} of ${formatWalkthroughTime(w.durationMs)}`}
            style={{ ['--fr-walkthrough-progress' as string]: `${(t / w.durationMs) * 100}%` }}
          />
          {markers.map((c) => (
            <button
              key={c.id}
              type="button"
              className="fr-walkthrough-bar__marker"
              style={{ left: `${(c.atMs / w.durationMs) * 100}%` }}
              title={`Comment at ${formatWalkthroughTime(c.atMs)}`}
              aria-label={`Go to the comment at ${formatWalkthroughTime(c.atMs)}`}
              onClick={() => {
                seek(c.atMs);
                setShowComments(true);
              }}
            />
          ))}
        </div>
        <span className="fr-walkthrough-bar__time fr-walkthrough-bar__total">{formatWalkthroughTime(w.durationMs)}</span>
        {!following && (
          <button type="button" className="fr-walkthrough-bar__back" onClick={backToView} title="Back to the narrator’s view (F)">
            <LocateFixed size={15} aria-hidden /> Back to {name.split(' ')[0]}’s view
          </button>
        )}
        <span className="fr-walkthrough-bar__sep" aria-hidden />
        {hasCaptions && (
          <IconButton icon={captionsOn ? Captions : CaptionsOff} label={captionsOn ? 'Hide captions (C)' : 'Show captions (C)'} active={captionsOn} onClick={() => setCaptionsOn((on) => !on)} />
        )}
        {canManage(editor, w) && <IconButton icon={Subtitles} label={hasCaptions ? 'Edit captions' : 'Add captions'} onClick={() => editor.openPanel(CAPTIONS_ID, { id: w.id })} />}
        <IconButton icon={MessageSquareText} label={`Comments (${markers.length})`} active={showComments} onClick={() => setShowComments((on) => !on)}>
          {markers.length > 0 && <span className="fr-walkthrough-bar__count">{markers.length}</span>}
        </IconButton>
        {editor.host.walkthroughs?.download && editor.host.board.canExport !== false && (
          <IconButton
            icon={Download}
            label="Download the recording"
            onClick={() => editor.host.walkthroughs?.download?.(w.id, w.title).catch((e: unknown) => editor.host.notify(e instanceof Error ? e.message : 'Download failed', 'error'))}
          />
        )}
        <IconButton icon={Flag} label="Report the recording" onClick={() => editor.runCommand('report.open', { target: { kind: 'upload', id: w.mediaUrl } })} />
        <IconButton icon={X} label="Close the walkthrough (Esc)" onClick={close} />
        {problem && (
          <span className="fr-walkthrough-bar__problem" role="alert">
            {problem}
          </span>
        )}
      </div>
    </>
  );
}
