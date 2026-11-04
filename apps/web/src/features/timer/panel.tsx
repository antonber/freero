import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Music, Pause, Play, Plus, Square, Timer as TimerIcon, VolumeX } from 'lucide-react';
import type { TimerState } from '@freero/shared';
import { definePanel, useCanEdit, useCollection, type Editor } from '@engine';
import { Button, IconButton, Input, Popover, Select, Slider, Tooltip } from '@ui';
import {
  MINUTE,
  addTime,
  elapsedMs,
  formatClock,
  parseDuration,
  pauseTimer,
  phaseOf,
  remainingMs,
  resumeTimer,
  startTimer,
  type TimerPhase,
} from './lib/timer';
import { playChime } from './lib/chime';
import { unlockAudioOnFirstGesture } from './lib/audio';
import { MUSIC_TRACKS, isMusicTrack, type MusicTrack } from './lib/music';
import { MusicPlayer } from './lib/musicPlayer';
import { hearsMusic, readMusicPref, readMuted, readVolume, writeMusicPref, writeMuted, writeVolume } from './lib/prefs';
import { t } from './messages';
import './timer.css';

const KEY = 'state';
const PRESETS = [1, 3, 5, 10, 15];
/** How long the pill flashes after reaching zero before settling into "Time's up". */
const FLASH_MS = 3200;

/** Server-clock time, re-rendered 4x a second while `active` (local only — never written). */
function useServerNow(editor: Editor, active: boolean): number {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [active]);
  return editor.host.serverNow();
}

function useMuted(): [boolean, (m: boolean) => void] {
  const [muted, setMuted] = useState(readMuted);
  return [
    muted,
    (m) => {
      writeMuted(m);
      setMuted(m);
    },
  ];
}

type MusicChoice = MusicTrack | 'none';

function trackLabel(track: MusicChoice): string {
  return track === 'drift' ? t('musicDrift') : track === 'pulse' ? t('musicPulse') : track === 'rain' ? t('musicRain') : t('musicNone');
}

const MUSIC_OPTIONS: ReadonlyArray<{ value: MusicChoice; label: string; description?: string }> = [
  { value: 'none', label: trackLabel('none') },
  ...MUSIC_TRACKS.map((track) => ({
    value: track,
    label: trackLabel(track),
    description: track === 'drift' ? t('musicDriftHint') : track === 'pulse' ? t('musicPulseHint') : t('musicRainHint'),
  })),
];

function musicOf(state: TimerState | undefined): MusicTrack | null {
  const track = state?.music?.track;
  return isMusicTrack(track) ? track : null;
}

/** The facilitator's music choice: when starting the timer, and while it runs. */
function MusicSelect({ value, onChange }: { value: MusicChoice; onChange: (v: MusicChoice) => void }) {
  return (
    <div className="fr-timer-music">
      <span className="fr-timer-music__label">{t('backgroundMusic')}</span>
      <Select<MusicChoice> options={MUSIC_OPTIONS} value={value} onChange={onChange} size="sm" width="100%" aria-label={t('backgroundMusic')} />
    </div>
  );
}

/** Each person's own: hear the music or not, and how loud. */
function MusicForMe({ on, onToggle, volume, onVolume, track }: { on: boolean; onToggle: (on: boolean) => void; volume: number; onVolume: (v: number) => void; track: MusicTrack }) {
  return (
    <div className="fr-timer-music-me">
      <button type="button" className="fr-timer-mute" aria-pressed={on} onClick={() => onToggle(!on)}>
        {on ? <Music size={15} /> : <VolumeX size={15} />}
        {on ? t('musicOnForYou', { track: trackLabel(track) }) : t('musicOffForYou', { track: trackLabel(track) })}
      </button>
      {on && (
        <Slider
          min={0}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          onChange={(v) => onVolume(v / 100)}
          aria-label={t('musicVolume')}
          className="fr-timer-volume"
        />
      )}
    </div>
  );
}

function MuteToggle({ muted, onChange }: { muted: boolean; onChange: (m: boolean) => void }) {
  return (
    <button type="button" className="fr-timer-mute" aria-pressed={muted} onClick={() => onChange(!muted)}>
      {muted ? <BellOff size={15} /> : <Bell size={15} />}
      {muted ? t('chimeMutedForYou') : t('chimeOnForYou')}
    </button>
  );
}

function Setup({ onStart }: { onStart: (ms: number, music: MusicTrack | null) => void }) {
  const [custom, setCustom] = useState('05:00');
  const [music, setMusic] = useState<MusicChoice>('none');
  const parsed = parseDuration(custom);
  return (
    <form
      className="fr-timer-setup"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed) onStart(parsed, music === 'none' ? null : music);
      }}
    >
      <div className="fr-timer-presets" role="group" aria-label={t('presets')}>
        {PRESETS.map((m) => {
          const value = formatClock(m * MINUTE);
          return (
            <button
              key={m}
              type="button"
              className={`fr-timer-preset${parsed === m * MINUTE ? ' is-active' : ''}`}
              aria-pressed={parsed === m * MINUTE}
              onClick={() => setCustom(value)}
            >{t('mMin', { m })}</button>
          );
        })}
      </div>
      <Input
        label={t('customMmSs')}
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        inputMode="numeric"
        error={custom.trim() && !parsed ? t('useMmSsUpTo') : undefined}
        aria-label={t('customDuration')}
        size="sm"
      />
      <MusicSelect value={music} onChange={setMusic} />
      <Button type="submit" variant="primary" icon={Play} block disabled={!parsed}>{t('start')}{' '}{parsed ? formatClock(parsed) : ''}
      </Button>
    </form>
  );
}

function Controls({ editor, state, phase, now }: { editor: Editor; state: TimerState; phase: TimerPhase; now: number }) {
  const canEdit = useCanEdit();
  const write = (next: TimerState) => editor.collection<TimerState>('timer').set(KEY, next);
  return (
    <div className="fr-timer-controls">
      <div className={`fr-timer-big${phase === 'paused' ? ' is-paused' : ''}`} aria-live="off">
        {formatClock(remainingMs(state, now))}
      </div>
      <div className="fr-timer-sub">{phase === 'paused' ? t('paused') : t('ofValue', { value: formatClock(state.duration) })}</div>
      {canEdit && (
        <div className="fr-timer-row">
          {phase === 'paused' ? (
            <Button size="sm" variant="primary" icon={Play} onClick={() => write(resumeTimer(state, editor.host.serverNow()))}>{t('resume')}</Button>
          ) : (
            <Button size="sm" icon={Pause} onClick={() => write(pauseTimer(state, editor.host.serverNow()))}>{t('pause')}</Button>
          )}
          <Button size="sm" icon={Plus} onClick={() => write(addTime(state, editor.host.serverNow()))}>{t('n1Min')}</Button>
          <Button size="sm" variant="ghost" icon={Square} onClick={() => editor.collection<TimerState>('timer').delete(KEY)}>{t('stop')}</Button>
        </div>
      )}
      {canEdit && (
        <MusicSelect
          value={musicOf(state) ?? 'none'}
          onChange={(v) => {
            const cur = editor.collection<TimerState>('timer').get(KEY);
            if (cur) write({ ...cur, music: v === 'none' ? null : { track: v } });
          }}
        />
      )}
    </div>
  );
}

function TimerPanel({ editor }: { editor: Editor }) {
  const entries = useCollection<TimerState>('timer');
  const state = entries.find(([k]) => k === KEY)?.[1];
  const canEdit = useCanEdit();
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useMuted();
  const [musicPref, setMusicPref] = useState(readMusicPref);
  const [volume, setVolume] = useState(readVolume);
  const player = useRef<MusicPlayer | null>(null);
  const [flashUntil, setFlashUntil] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);

  const ticking = !!state && (state.running || flashUntil > 0);
  const now = useServerNow(editor, ticking);
  let phase = phaseOf(state, now);
  if (phase === 'done' && dismissedAt === state?.endsAt) phase = 'idle';

  useEffect(() => unlockAudioOnFirstGesture(), []);

  // Music: plays while the countdown runs, at the timer's own position (everyone in step).
  const track = musicOf(state);
  const musicOn = hearsMusic(musicPref, state?.startedBy, editor.user.id);
  const playMusic = !!track && musicOn && phase === 'running';
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!playMusic || !track) {
      player.current?.stop();
      return;
    }
    player.current ??= new MusicPlayer();
    player.current.play(
      track,
      () => (stateRef.current ? elapsedMs(stateRef.current, editor.host.serverNow()) : 0),
      () => stateRef.current?.duration ?? 0,
    );
  }, [playMusic, track, editor]);
  useEffect(() => player.current?.setVolume(volume), [volume, playMusic]);
  useEffect(() => () => player.current?.stop(), []);

  // Chime + flash only for clients that watched the countdown cross zero (not late joiners).
  const prev = useRef<{ phase: TimerPhase; endsAt: number | null }>({ phase, endsAt: state?.endsAt ?? null });
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  useEffect(() => {
    const p = prev.current;
    const endsAt = state?.endsAt ?? null;
    if (phase === 'done' && p.phase === 'running' && p.endsAt === endsAt) {
      if (!mutedRef.current) playChime();
      setFlashUntil(Date.now() + FLASH_MS);
      setOpen(false);
    }
    prev.current = { phase, endsAt };
  }, [phase, state?.endsAt]);
  useEffect(() => {
    if (!flashUntil) return;
    const id = setTimeout(() => setFlashUntil(0), Math.max(0, flashUntil - Date.now()));
    return () => clearTimeout(id);
  }, [flashUntil]);

  if (phase === 'idle' && !canEdit) return null;

  const start = (ms: number, music: MusicTrack | null) => {
    editor.collection<TimerState>('timer').set(KEY, { ...startTimer(ms, editor.host.serverNow(), editor.user.id), music: music ? { track: music } : null });
    setDismissedAt(null);
    setOpen(false);
  };

  let trigger;
  if (phase === 'idle') {
    trigger = <IconButton ref={anchor} icon={TimerIcon} label={t('timer')} active={open} onClick={() => setOpen((o) => !o)} />;
  } else if (phase === 'done') {
    const flashing = flashUntil > Date.now();
    trigger = (
      <Tooltip content={t('dismiss')} side="bottom">
        <button
          ref={anchor}
          type="button"
          className={`fr-timer-pill is-done${flashing ? ' is-flashing' : ''}`}
          onClick={() => setDismissedAt(state?.endsAt ?? null)}
          aria-label={t('timeSUpClickTo')}
        >
          <TimerIcon size={16} />
          {flashing ? '00:00' : t('timeSUp')}
        </button>
      </Tooltip>
    );
  } else {
    const ms = remainingMs(state, now);
    trigger = (
      <button
        ref={anchor}
        type="button"
        className={`fr-timer-pill${phase === 'paused' ? ' is-paused' : ''}${phase === 'running' && ms <= 10_000 ? ' is-ending' : ''}`}
        aria-label={t('timerValueValue2', { value: formatClock(ms), value2: phase === 'paused' ? t('paused2') : '' })}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {phase === 'paused' ? <Pause size={15} /> : <TimerIcon size={16} />}
        <span className="fr-timer-pill__time">{formatClock(ms)}</span>
      </button>
    );
  }

  return (
    <>
      {trigger}
      <Popover open={open && phase !== 'done'} onClose={() => setOpen(false)} anchor={anchor.current} side="bottom" align="end" width={296} aria-label={t('timer')}>
        <div className="fr-timer-pop">
          <div className="fr-timer-pop__title">{t('timer')}</div>
          {phase === 'idle' ? (
            <Setup onStart={start} />
          ) : (
            state && <Controls editor={editor} state={state} phase={phase} now={now} />
          )}
          {track && phase !== 'idle' && (
            <MusicForMe
              track={track}
              on={musicOn}
              onToggle={(on) => {
                writeMusicPref(on);
                setMusicPref(on);
              }}
              volume={volume}
              onVolume={(v) => {
                writeVolume(v);
                setVolume(v);
              }}
            />
          )}
          <MuteToggle muted={muted} onChange={setMuted} />
        </div>
      </Popover>
    </>
  );
}

export default definePanel({
  id: 'timer.panel',
  slot: 'topbar-right',
  order: 20,
  Component: TimerPanel,
});
