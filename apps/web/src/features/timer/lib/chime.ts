// A soft three-note chime synthesized with WebAudio (no audio files), plus the per-user mute
// preference (localStorage; never synced).

const MUTE_KEY = 'freero.timer.muted';

export function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, '1');
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    /* storage blocked: the toggle still works for this page */
  }
}

type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor: AudioCtor | undefined =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/**
 * Browsers only let audio start after a user gesture. Creating/resuming the context on the
 * first pointer or key press means the chime can play later, when the countdown ends.
 */
export function unlockAudioOnFirstGesture(): () => void {
  const unlock = () => {
    const c = audio();
    if (c && c.state === 'suspended') void c.resume();
    off();
  };
  const off = () => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  return off;
}

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
