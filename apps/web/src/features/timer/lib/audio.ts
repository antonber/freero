// The page's one AudioContext for the timer's chime and music (both synthesized; no audio files).

type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;

export function audio(): AudioContext | null {
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
