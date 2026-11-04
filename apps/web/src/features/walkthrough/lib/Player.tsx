// Watching a walkthrough: the recording plays while the LIVE board follows the narrator's view —
// the camera is set from the recording's own clock every frame, so the view can never drift from
// the voice. The viewer's own pan or zoom takes the camera back (the bar offers "Back to their
// view"); pausing leaves the camera alone; playing again returns to the recorded path.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { Captions, CaptionsOff, Download, Flag, ListOrdered, LocateFixed, MessageSquareText, Mic, Pause, PenLine, Play, UserRound, X } from 'lucide-react';
import { formatWalkthroughTime, WALKTHROUGHS_COLLECTION, type Walkthrough, type WalkthroughSummary, type WalkthroughTimeline } from '@freero/shared';
import { useCamera, useCollection, usePeople, type Editor, type PanelProps } from '@engine';
import { Avatar, IconButton, Spinner } from '@ui';
import { ChaptersList } from './Chapters';
import { Comments, useWalkthroughComments } from './Comments';
import { CAPTIONS_ID, CHAPTERS_ID } from './ids';
import { closeWalkthrough, usePlayer } from './playback';
import { ReactButton, useWalkthroughReactions } from './Reactions';
import { cameraShowing, chapterAt, cueAt, pointerAt, reactionMarks, speakerAt, viewAt, type PresenterTrack } from './timeline';

import { t as tr } from '../messages';
const STEP_MS = 5000;

export function PlayerOverlay({ editor }: PanelProps) {
  const p = usePlayer();
  if (p.walkthrough) return <Player key={`${p.walkthrough.id}:${p.session}`} editor={editor} w={p.walkthrough} startAt={p.startAt} />;
  if (!p.loading) return null;
  return (
    <div className="fr-walkthrough-bar" role="status" data-fr-occludes="" data-fr-interactive="">
      <Spinner size={16} />
      <span className="fr-walkthrough-bar__hint">{tr('openingTheWalkthrough')}</span>
    </div>
  );
}

const canManage = (editor: Editor, w: Walkthrough) => w.authorId === editor.user.id || editor.can('editor');

/** #128: every presenter's track on the walkthrough's clock — the host's first. */
interface Track extends PresenterTrack {
  key: string;
  userId: string | null;
  name: string;
  mediaUrl: string;
  media: 'audio' | 'video';
  removed: boolean;
}

function tracksOf(w: Walkthrough): Track[] {
  const host: Track = { key: 'host', userId: w.authorId, name: w.author?.name ?? 'Narrator', offsetMs: 0, durationMs: w.durationMs, timeline: w.timeline, mediaUrl: w.mediaUrl, media: w.media, removed: w.mediaRemoved };
  return [
    host,
    ...(w.voices ?? []).map((v): Track => ({ key: v.id, userId: v.author?.id ?? null, name: v.author?.name ?? 'Presenter', offsetMs: v.offsetMs, durationMs: v.durationMs, timeline: v.timeline, mediaUrl: v.mediaUrl, media: v.media, removed: v.mediaRemoved })),
  ];
}

const talking = (tl: WalkthroughTimeline, local: number) => (tl.speech ?? []).some(([s, e]) => s <= local && local <= e);

/** MediaRecorder's WebM files don't say how long they are: asking for the very end makes the browser find out (so seeking works), then go to `ms`. */
function primeDuration(el: HTMLMediaElement, ms: number) {
  if (Number.isFinite(el.duration)) {
    el.currentTime = ms / 1000;
    return;
  }
  const back = () => {
    el.removeEventListener('timeupdate', back);
    el.currentTime = ms / 1000;
  };
  el.addEventListener('timeupdate', back);
  el.currentTime = 1e101;
}

/** Keeps another presenter's recording at the walkthrough's moment `ms` (plays, pauses and seeks with it). */
function syncVoice(el: HTMLMediaElement, track: Track, ms: number, playing: boolean) {
  const local = ms - track.offsetMs;
  const inside = local >= 0 && local < track.durationMs;
  if (!playing || !inside) {
    if (!el.paused) el.pause();
    if (!playing && inside && Math.abs(el.currentTime * 1000 - local) > 250) el.currentTime = local / 1000;
    return;
  }
  if (Math.abs(el.currentTime * 1000 - local) > 300) el.currentTime = local / 1000;
  if (el.paused) void el.play().catch(() => undefined);
}

function Player({ editor, w, startAt }: { editor: Editor; w: Walkthrough; startAt: number }) {
  const media = useRef<HTMLMediaElement | null>(null);
  const [t, setT] = useState(startAt);
  const [playing, setPlaying] = useState(false);
  const [following, setFollowingState] = useState(true);
  const followingRef = useRef(true);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [showComments, setShowComments] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [problem, setProblem] = useState<string | null>(w.mediaRemoved ? 'Freero’s moderators removed this recording.' : null);
  const counted = useRef(false);
  const lastApplied = useRef<number | null>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const tracks = tracksOf(w);
  const group = tracks.length > 1;
  const voiceEls = useRef(new Map<string, HTMLMediaElement>());
  // Whose view to follow with several presenters: whoever is speaking, or always the host.
  const [followWho, setFollowWho] = useState<'speaker' | 'host'>('speaker');
  const followWhoRef = useRef(followWho);
  followWhoRef.current = followWho;
  const people = usePeople(tracks.flatMap((x) => (x.userId ? [x.userId] : [])));
  const author = (w.authorId && people[w.authorId]) || null;
  const colorOf = (x: Track) => (x.userId && people[x.userId]?.color) || '#5b3ff0';
  const summary = new Map(useCollection<WalkthroughSummary>(WALKTHROUGHS_COLLECTION)).get(w.id);
  const comments = useWalkthroughComments(editor, w.id, summary?.comments ?? w.comments);
  const reactions = useWalkthroughReactions(editor, w.id, summary?.reactions ?? w.reactions ?? 0);
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
      const all = tracksOf(w);
      const who = all.length > 1 && followWhoRef.current === 'speaker' ? all[speakerAt(all, ms)] : all[0];
      const r = viewAt(who.timeline, Math.max(0, Math.min(who.durationMs, ms - who.offsetMs)));
      if (r) editor.setCamera(cameraShowing(r, editor.getViewportSize()));
    },
    [editor, w],
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
      // The other presenters' recordings follow the host's (the walkthrough's clock).
      if (el)
        for (const x of tracksOf(w).slice(1)) {
          const v = voiceEls.current.get(x.key);
          if (v && !x.removed) syncVoice(v, x, el.currentTime * 1000, !el.paused);
        }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [apply, w]);

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
      setProblem(tr('theRecordingCanTBe'));
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
    if (media.current) primeDuration(media.current, startAt);
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
  const name = w.author?.name ?? 'Narrator';
  const color = author?.color ?? '#5b3ff0';
  // Every presenter's pointer, in their colour.
  const pointers = tracks.flatMap((x) => {
    const local = t - x.offsetMs;
    if (local < 0 || local > x.durationMs) return [];
    const p = pointerAt(x.timeline, local);
    return p ? [{ x, at: editor.worldToScreen(p) }] : [];
  });
  const followed = group && followWho === 'speaker' ? tracks[speakerAt(tracks, t)] : tracks[0];
  const hasCaptions = !!w.transcript?.length;
  const markers = comments.list ?? [];
  const marks = reactionMarks(reactions.list, w.durationMs);
  const chapters = w.chapters ?? [];
  const chapter = chapterAt(chapters, t);

  return (
    <>
      {pointers.map(({ x, at }) => (
        <div key={x.key} className="fr-walkthrough-pointer" style={{ transform: `translate(${at.x}px, ${at.y}px)`, ['--fr-walkthrough-color' as string]: colorOf(x) }} aria-hidden>
          <span className="fr-walkthrough-pointer__dot" />
          <span className="fr-walkthrough-pointer__name">{x.name}</span>
        </div>
      ))}

      {group && (
        <div className="fr-walkthrough-voices" data-fr-occludes="" data-fr-interactive="" role="group" aria-label={tr('presentersNames', { names: tracks.map((x) => x.name).join(', ') })}>
          {tracks.slice(1).map((v) => {
            const local = t - v.offsetMs;
            const speaking = playing && local >= 0 && local <= v.durationMs && talking(v.timeline, local);
            const ref = (el: HTMLMediaElement | null) => {
              if (el) voiceEls.current.set(v.key, el);
              else voiceEls.current.delete(v.key);
            };
            const prime = (e: SyntheticEvent<HTMLMediaElement>) => primeDuration(e.currentTarget, Math.max(0, t - v.offsetMs));
            return (
              <div key={v.key} className={`fr-walkthrough-voice${speaking ? ' is-speaking' : ''}`} style={{ ['--fr-walkthrough-color' as string]: colorOf(v) }} title={v.name}>
                {v.media === 'video' && !v.removed ? (
                  <video ref={ref} className="fr-walkthrough-bubble__video" src={v.mediaUrl} preload="metadata" playsInline onLoadedMetadata={prime} aria-label={tr('nameSCamera', { name: v.name })} />
                ) : (
                  <>
                    <Avatar name={v.name} color={colorOf(v)} src={(v.userId && people[v.userId]?.avatarUrl) || null} size={44} />
                    {!v.removed && <audio ref={ref} src={v.mediaUrl} preload="metadata" onLoadedMetadata={prime} />}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className={`fr-walkthrough-bubble${playing && (!group || talking(w.timeline, t)) ? ' is-speaking' : ''}`} style={{ ['--fr-walkthrough-color' as string]: color }} data-fr-occludes="" data-fr-interactive="">
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
            onError={() => setProblem((p) => p ?? tr('theRecordingIsGoneOr'))}
            aria-label={tr('nameSCamera', { name })}
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
              onError={() => setProblem((p) => p ?? tr('theRecordingIsGoneOr'))}
            />
          </>
        )}
      </div>

      {cue && (
        <div className="fr-walkthrough-caption" lang="">
          {cue.speaker && <span className="fr-walkthrough-caption__speaker">{tr('speakerSays', { name: cue.speaker })}</span>}
          {cue.text}
        </div>
      )}

      {showComments && <Comments editor={editor} w={w} t={t} state={comments} onSeek={seek} onClose={() => setShowComments(false)} />}
      {showChapters && !showComments && (
        <ChaptersList
          editor={editor}
          w={w}
          t={t}
          onSeek={seek}
          onClose={() => setShowChapters(false)}
          onEdit={canManage(editor, w) && editor.host.walkthroughs?.setChapters ? () => editor.openPanel(CHAPTERS_ID, { id: w.id }) : undefined}
        />
      )}

      <div className="fr-walkthrough-bar is-playing" role="region" aria-label={tr('walkthroughTitle', { title: w.title })} onKeyDown={onKeyDown} data-fr-occludes="" data-fr-interactive="">
        <IconButton ref={playButton} icon={playing ? Pause : Play} label={playing ? tr('pauseSpace') : tr('playSpace')} onClick={toggle} disabled={!!problem} />
        <span className="fr-walkthrough-bar__time">{formatWalkthroughTime(t)}</span>
        <div className="fr-walkthrough-bar__track">
          {chapters.map((c) =>
            c.atMs > 0 ? (
              <button
                key={`c${c.atMs}`}
                type="button"
                className="fr-walkthrough-bar__chapter"
                style={{ left: `${(c.atMs / w.durationMs) * 100}%` }}
                title={`${formatWalkthroughTime(c.atMs)} ${c.title}`}
                aria-label={tr('goToTheChapterTitle', { title: c.title, value: formatWalkthroughTime(c.atMs) })}
                onClick={() => seek(c.atMs)}
              />
            ) : null,
          )}
          {marks.map((m) => (
            <button
              key={`r${m.atMs}`}
              type="button"
              className={`fr-walkthrough-bar__reaction${m.mine ? ' is-mine' : ''}`}
              style={{ left: `${(m.atMs / w.durationMs) * 100}%` }}
              title={tr('joinAtValue', { join: m.counts.map((c) => `${c.emoji} ${c.n}`).join('  '), value: formatWalkthroughTime(m.atMs) })}
              aria-label={tr('reactionsAtValueJoin', { value: formatWalkthroughTime(m.atMs), join: m.counts.map((c) => `${c.emoji} ${c.n}`).join(', ') })}
              onClick={() => seek(m.atMs)}
            >
              {m.counts[0].emoji}
              {m.counts.reduce((s, c) => s + c.n, 0) > 1 && <span>{m.counts.reduce((s, c) => s + c.n, 0)}</span>}
            </button>
          ))}
          <input
            type="range"
            className="fr-walkthrough-bar__range"
            min={0}
            max={w.durationMs}
            step={250}
            value={Math.round(t)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label={tr('positionInTheWalkthrough')}
            aria-valuetext={tr('valueOfValue2', { value: formatWalkthroughTime(t), value2: formatWalkthroughTime(w.durationMs) })}
            style={{ ['--fr-walkthrough-progress' as string]: `${(t / w.durationMs) * 100}%` }}
          />
          {markers.map((c) => (
            <button
              key={c.id}
              type="button"
              className="fr-walkthrough-bar__marker"
              style={{ left: `${(c.atMs / w.durationMs) * 100}%` }}
              title={tr('commentAtValue2', { value: formatWalkthroughTime(c.atMs) })}
              aria-label={tr('goToTheCommentAt', { value: formatWalkthroughTime(c.atMs) })}
              onClick={() => {
                seek(c.atMs);
                setShowComments(true);
              }}
            />
          ))}
        </div>
        <span className="fr-walkthrough-bar__time fr-walkthrough-bar__total">{formatWalkthroughTime(w.durationMs)}</span>
        {!following && (
          <button type="button" className="fr-walkthrough-bar__back" onClick={backToView} title={tr('backToTheNarratorS')}>
            <LocateFixed size={15} aria-hidden />{' '}{tr('backToValueSView', { value: followed.name.split(' ')[0] })}</button>
        )}
        {group && (
          <IconButton
            icon={followWho === 'speaker' ? Mic : UserRound}
            label={followWho === 'speaker' ? tr('followingWhoeverSpeaks', { name }) : tr('followingName', { name })}
            active={followWho === 'speaker'}
            onClick={() => {
              const next = followWho === 'speaker' ? 'host' : 'speaker';
              followWhoRef.current = next;
              setFollowWho(next);
              setFollowing(true);
              apply(t, true);
            }}
          />
        )}
        <span className="fr-walkthrough-bar__sep" aria-hidden />
        {hasCaptions && (
          <IconButton icon={captionsOn ? Captions : CaptionsOff} label={captionsOn ? tr('hideCaptionsC') : tr('showCaptionsC')} active={captionsOn} onClick={() => setCaptionsOn((on) => !on)} />
        )}
        {canManage(editor, w) && <IconButton icon={PenLine} label={hasCaptions ? tr('editCaptions') : tr('addCaptions')} onClick={() => editor.openPanel(CAPTIONS_ID, { id: w.id })} />}
        {(chapters.length > 0 || !!w.summary || (canManage(editor, w) && !!editor.host.walkthroughs?.setChapters)) && (
          <IconButton
            icon={ListOrdered}
            label={chapter ? tr('chaptersTitle', { title: chapter.title }) : tr('chaptersLength', { length: chapters.length })}
            active={showChapters && !showComments}
            onClick={() => {
              setShowComments(false);
              setShowChapters((on) => !on || showComments);
            }}
          />
        )}
        <ReactButton editor={editor} id={w.id} t={t} state={reactions} />
        <IconButton icon={MessageSquareText} label={tr('walkthroughCommentsLength', { length: markers.length })} active={showComments} onClick={() => setShowComments((on) => !on)}>
          {markers.length > 0 && <span className="fr-walkthrough-bar__count">{markers.length}</span>}
        </IconButton>
        {editor.host.walkthroughs?.download && editor.host.board.canExport !== false && (
          <IconButton
            icon={Download}
            label={tr('downloadTheRecording')}
            onClick={() => editor.host.walkthroughs?.download?.(w.id, w.title).catch((e: unknown) => editor.host.notify(e instanceof Error ? e.message : tr('downloadFailed'), 'error'))}
          />
        )}
        <IconButton icon={Flag} label={tr('reportTheRecording')} onClick={() => editor.runCommand('report.open', { target: { kind: 'upload', id: w.mediaUrl } })} />
        <IconButton icon={X} label={tr('closeTheWalkthroughEsc')} onClick={close} />
        {problem && (
          <span className="fr-walkthrough-bar__problem" role="alert">
            {problem}
          </span>
        )}
      </div>
    </>
  );
}
