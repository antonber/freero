// The play / pause, seek and mute controls of video and audio items: plain DOM marked
// data-fr-interactive (the world layer ignores pointer events everywhere else, so the item itself
// still selects and drags like any other).
import { useEffect, useState, type PointerEvent, type RefObject } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { formatTime } from './kinds';

export interface Playback {
  playing: boolean;
  time: number;
  duration: number;
  muted: boolean;
}

const EVENTS = ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'seeked', 'emptied'] as const;

/** Live state of the <video>/<audio> in `ref` (re-attached whenever `mounted` changes). */
export function usePlayback(ref: RefObject<HTMLMediaElement>, mounted: boolean, fallbackDuration: number): Playback {
  const [state, setState] = useState<Playback>({ playing: false, time: 0, duration: fallbackDuration, muted: false });
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const sync = () =>
      setState({
        playing: !m.paused && !m.ended,
        time: m.currentTime,
        duration: Number.isFinite(m.duration) && m.duration > 0 ? m.duration : fallbackDuration,
        muted: m.muted,
      });
    for (const e of EVENTS) m.addEventListener(e, sync);
    sync();
    return () => {
      for (const e of EVENTS) m.removeEventListener(e, sync);
    };
  }, [ref, mounted, fallbackDuration]);
  return state;
}

/** Plays or pauses; a first play mounts the player (`start`), which then autoplays. */
export function togglePlayback(m: HTMLMediaElement | null, start: () => void) {
  if (!m) return start();
  if (m.paused || m.ended) void m.play().catch(() => undefined);
  else m.pause();
}

const stop = (e: PointerEvent) => e.stopPropagation();

export function Controls({
  state,
  media,
  onToggle,
  variant,
}: {
  state: Playback;
  media: HTMLMediaElement | null;
  onToggle(): void;
  /** Audio cards have their own big play button, so their row has none. */
  variant: 'video' | 'audio';
}) {
  const { playing, time, duration, muted } = state;
  return (
    <div className={`fr-media-controls fr-media-controls--${variant}`} data-fr-interactive="" onPointerDown={stop} onDoubleClick={(e) => e.stopPropagation()}>
      {variant === 'video' && (
        <button type="button" className="fr-media-controls__play" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'} onClick={onToggle}>
          {playing ? <Pause size="1.15em" fill="currentColor" strokeWidth={0} /> : <Play size="1.15em" fill="currentColor" strokeWidth={0} />}
        </button>
      )}
      <input
        className="fr-media-controls__seek"
        type="range"
        min={0}
        max={duration || 0}
        step="any"
        value={Math.min(time, duration || 0)}
        disabled={!media || !duration}
        aria-label="Seek"
        style={{ ['--fr-media-progress' as string]: duration ? `${(Math.min(time, duration) / duration) * 100}%` : '0%' }}
        onChange={(e) => {
          if (media) media.currentTime = Number(e.target.value);
        }}
      />
      <span className="fr-media-controls__time">
        {media ? `${formatTime(time)} / ` : ''}
        {formatTime(duration)}
      </span>
      <button
        type="button"
        className="fr-media-controls__mute"
        aria-label={muted ? 'Unmute' : 'Mute'}
        title={muted ? 'Unmute' : 'Mute'}
        disabled={!media}
        onClick={() => {
          if (media) media.muted = !media.muted;
        }}
      >
        {muted ? <VolumeX size="1.1em" /> : <Volume2 size="1.1em" />}
      </button>
    </div>
  );
}
