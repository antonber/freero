import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Pause, Play, Plus, Square, Timer as TimerIcon } from 'lucide-react';
import type { TimerState } from '@freero/shared';
import { definePanel, useCanEdit, useCollection, type Editor } from '@engine';
import { Button, IconButton, Input, Popover, Tooltip } from '@ui';
import {
  MINUTE,
  addTime,
  formatClock,
  parseDuration,
  pauseTimer,
  phaseOf,
  remainingMs,
  resumeTimer,
  startTimer,
  type TimerPhase,
} from './lib/timer';
import { playChime, readMuted, unlockAudioOnFirstGesture, writeMuted } from './lib/chime';
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

function MuteToggle({ muted, onChange }: { muted: boolean; onChange: (m: boolean) => void }) {
  return (
    <button type="button" className="fr-timer-mute" aria-pressed={muted} onClick={() => onChange(!muted)}>
      {muted ? <BellOff size={15} /> : <Bell size={15} />}
      {muted ? 'Chime muted for you' : 'Chime on for you'}
    </button>
  );
}

function Setup({ onStart }: { onStart: (ms: number) => void }) {
  const [custom, setCustom] = useState('05:00');
  const parsed = parseDuration(custom);
  return (
    <form
      className="fr-timer-setup"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed) onStart(parsed);
      }}
    >
      <div className="fr-timer-presets" role="group" aria-label="Presets">
        {PRESETS.map((m) => {
          const value = formatClock(m * MINUTE);
          return (
            <button
              key={m}
              type="button"
              className={`fr-timer-preset${parsed === m * MINUTE ? ' is-active' : ''}`}
              aria-pressed={parsed === m * MINUTE}
              onClick={() => setCustom(value)}
            >
              {m} min
            </button>
          );
        })}
      </div>
      <Input
        label="Custom (mm:ss)"
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        inputMode="numeric"
        error={custom.trim() && !parsed ? 'Use mm:ss, up to 99:59' : undefined}
        aria-label="Custom duration"
        size="sm"
      />
      <Button type="submit" variant="primary" icon={Play} block disabled={!parsed}>
        Start {parsed ? formatClock(parsed) : ''}
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
      <div className="fr-timer-sub">{phase === 'paused' ? 'Paused' : `of ${formatClock(state.duration)}`}</div>
      {canEdit && (
        <div className="fr-timer-row">
          {phase === 'paused' ? (
            <Button size="sm" variant="primary" icon={Play} onClick={() => write(resumeTimer(state, editor.host.serverNow()))}>
              Resume
            </Button>
          ) : (
            <Button size="sm" icon={Pause} onClick={() => write(pauseTimer(state, editor.host.serverNow()))}>
              Pause
            </Button>
          )}
          <Button size="sm" icon={Plus} onClick={() => write(addTime(state, editor.host.serverNow()))}>
            1 min
          </Button>
          <Button size="sm" variant="ghost" icon={Square} onClick={() => editor.collection<TimerState>('timer').delete(KEY)}>
            Stop
          </Button>
        </div>
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
  const [flashUntil, setFlashUntil] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);

  const ticking = !!state && (state.running || flashUntil > 0);
  const now = useServerNow(editor, ticking);
  let phase = phaseOf(state, now);
  if (phase === 'done' && dismissedAt === state?.endsAt) phase = 'idle';

  useEffect(() => unlockAudioOnFirstGesture(), []);

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

  const start = (ms: number) => {
    editor.collection<TimerState>('timer').set(KEY, startTimer(ms, editor.host.serverNow(), editor.user.id));
    setDismissedAt(null);
    setOpen(false);
  };

  let trigger;
  if (phase === 'idle') {
    trigger = <IconButton ref={anchor} icon={TimerIcon} label="Timer" active={open} onClick={() => setOpen((o) => !o)} />;
  } else if (phase === 'done') {
    const flashing = flashUntil > Date.now();
    trigger = (
      <Tooltip content="Dismiss" side="bottom">
        <button
          ref={anchor}
          type="button"
          className={`fr-timer-pill is-done${flashing ? ' is-flashing' : ''}`}
          onClick={() => setDismissedAt(state?.endsAt ?? null)}
          aria-label="Time's up. Click to dismiss"
        >
          <TimerIcon size={16} />
          {flashing ? '00:00' : "Time's up"}
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
        aria-label={`Timer ${formatClock(ms)}${phase === 'paused' ? ', paused' : ''}`}
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
      <Popover open={open && phase !== 'done'} onClose={() => setOpen(false)} anchor={anchor.current} side="bottom" align="end" width={296} aria-label="Timer">
        <div className="fr-timer-pop">
          <div className="fr-timer-pop__title">Timer</div>
          {phase === 'idle' ? (
            <Setup onStart={start} />
          ) : (
            state && <Controls editor={editor} state={state} phase={phase} now={now} />
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
