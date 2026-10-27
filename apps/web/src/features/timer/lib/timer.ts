// Pure timer model. The doc stores only `endsAt` (running) or `pausedRemaining` (paused) in
// server-clock milliseconds; every client derives the countdown locally, so nothing is written
// while the timer ticks. All `now` values here are server-clock ms (see ./clock.ts).
import type { TimerState } from '@freero/shared';

export const MINUTE = 60_000;
/** Longest timer anyone can set (99:59). */
export const MAX_DURATION = 99 * MINUTE + 59_000;
/** A finished timer stops showing "Time's up" to people who arrive this long after it ended. */
export const DONE_TTL = 10 * MINUTE;

export type TimerPhase = 'idle' | 'running' | 'paused' | 'done';

export function remainingMs(state: TimerState | undefined | null, now: number): number {
  if (!state) return 0;
  if (state.running && state.endsAt != null) return Math.max(0, state.endsAt - now);
  return Math.max(0, state.pausedRemaining ?? 0);
}

export function phaseOf(state: TimerState | undefined | null, now: number): TimerPhase {
  if (!state) return 'idle';
  if (!state.running) return state.pausedRemaining != null && state.pausedRemaining > 0 ? 'paused' : 'idle';
  if (state.endsAt == null) return 'idle';
  if (now < state.endsAt) return 'running';
  return now - state.endsAt < DONE_TTL ? 'done' : 'idle';
}

export function startTimer(duration: number, now: number, userId: string): TimerState {
  const d = Math.min(MAX_DURATION, Math.max(1000, Math.round(duration)));
  return { endsAt: now + d, duration: d, pausedRemaining: null, running: true, startedBy: userId };
}

export function pauseTimer(state: TimerState, now: number): TimerState {
  if (!state.running || state.endsAt == null) return state;
  return { ...state, running: false, endsAt: null, pausedRemaining: Math.max(0, state.endsAt - now) };
}

export function resumeTimer(state: TimerState, now: number): TimerState {
  if (state.running || state.pausedRemaining == null) return state;
  return { ...state, running: true, endsAt: now + state.pausedRemaining, pausedRemaining: null };
}

/** +1 min: extends a running or paused timer in place; a finished one restarts with a minute. */
export function addTime(state: TimerState, now: number, ms = MINUTE): TimerState {
  if (state.running && state.endsAt != null) {
    const base = Math.max(state.endsAt, now); // a timer at zero gets a full extra minute
    const endsAt = Math.min(base + ms, now + MAX_DURATION);
    return { ...state, endsAt, duration: state.duration + (endsAt - base) };
  }
  if (state.pausedRemaining != null) {
    const pausedRemaining = Math.min(state.pausedRemaining + ms, MAX_DURATION);
    return { ...state, pausedRemaining, duration: state.duration + (pausedRemaining - state.pausedRemaining) };
  }
  return state;
}

/** "mm:ss", rounding up so the display reads 00:01 until the very end. */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Parses a custom duration: "4:30", "04:30", "90s"-free plain minutes ("5"), or ":45".
 * Returns ms, or null when the value is empty, zero, malformed or above 99:59.
 */
export function parseDuration(input: string): number | null {
  const v = input.trim();
  let m: number;
  let s: number;
  const clock = /^(\d{0,2}):(\d{1,2})$/.exec(v);
  if (clock) {
    m = clock[1] ? Number(clock[1]) : 0;
    s = Number(clock[2]);
    if (s > 59) return null;
  } else if (/^\d{1,2}$/.test(v)) {
    m = Number(v);
    s = 0;
  } else return null;
  const ms = (m * 60 + s) * 1000;
  return ms > 0 && ms <= MAX_DURATION ? ms : null;
}
