import { describe, expect, it } from 'vitest';
import { addTime, MINUTE, parseDuration, pauseTimer, phaseOf, remainingMs, resumeTimer, startTimer } from './lib/timer';

describe('shared countdown', () => {
  it('pause then resume keeps the remaining time, however long the pause lasted', () => {
    const t0 = 1_000_000;
    let s = startTimer(3 * MINUTE, t0, 'u');
    s = pauseTimer(s, t0 + 50_000); // 2:10 left
    expect(phaseOf(s, t0 + 10 * MINUTE)).toBe('paused');
    expect(remainingMs(s, t0 + 10 * MINUTE)).toBe(130_000);
    s = resumeTimer(s, t0 + 10 * MINUTE);
    expect(remainingMs(s, t0 + 10 * MINUTE + 30_000)).toBe(100_000);
  });

  it('+1 min extends a running or paused countdown instead of restarting it', () => {
    const t0 = 5_000_000;
    const running = addTime(startTimer(2 * MINUTE, t0, 'u'), t0 + 30_000);
    expect(remainingMs(running, t0 + 30_000)).toBe(150_000);

    const paused = addTime(pauseTimer(startTimer(2 * MINUTE, t0, 'u'), t0 + 30_000), t0 + 99_000);
    expect(remainingMs(paused, t0 + 99_000)).toBe(150_000);

    // At zero, +1 min gives a full minute rather than whatever is left of the overshoot.
    const finished = addTime(startTimer(MINUTE, t0, 'u'), t0 + 5 * MINUTE);
    expect(remainingMs(finished, t0 + 5 * MINUTE)).toBe(MINUTE);
  });

  it("doesn't greet someone who opens the board long after the end with \"Time's up\"", () => {
    const s = startTimer(MINUTE, 0, 'u');
    expect(phaseOf(s, MINUTE + 1000)).toBe('done');
    expect(phaseOf(s, MINUTE + 60 * MINUTE)).toBe('idle');
  });

  it('custom durations accept m:ss and plain minutes but reject zero, bad seconds and junk', () => {
    expect(parseDuration('4:30')).toBe(270_000);
    expect(parseDuration(':45')).toBe(45_000);
    expect(parseDuration('7')).toBe(7 * MINUTE);
    for (const bad of ['0:00', '0', '3:75', 'abc', '', '100:00']) expect(parseDuration(bad)).toBeNull();
  });
});
