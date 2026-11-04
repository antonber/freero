// A soft three-note chime synthesized with WebAudio (no audio files).
import { audio } from './audio';

/** C6 → E6 → G6, sine with a bell-like soft attack and long tail. */
export function playChime(): void {
  const c = audio();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  const start = c.currentTime + 0.02;
  const master = c.createGain();
  master.gain.value = 0.18;
  master.connect(c.destination);
  [1046.5, 1318.5, 1568].forEach((freq, i) => {
    const t = start + i * 0.18;
    for (const [mult, level] of [
      [1, 1],
      [2, 0.12], // a faint overtone makes it sound like a bell, not a beep
    ] as const) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 1.5);
    }
  });
}
