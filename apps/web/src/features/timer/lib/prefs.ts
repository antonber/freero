// Each person's own sound settings for the timer, in this browser only (localStorage; never
// synced): the chime's mute, whether they hear the background music, and its volume.

const MUTE_KEY = 'freero.timer.muted';
const MUSIC_KEY = 'freero.timer.music';
const VOLUME_KEY = 'freero.timer.musicVolume';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the setting still works for this page */
  }
}

export function readMuted(): boolean {
  return read(MUTE_KEY) === '1';
}

export function writeMuted(muted: boolean): void {
  write(MUTE_KEY, muted ? '1' : null);
}

/** The person's music choice: true / false once they've toggled it, else null (the default applies). */
export function readMusicPref(): boolean | null {
  const v = read(MUSIC_KEY);
  return v === 'on' ? true : v === 'off' ? false : null;
}

export function writeMusicPref(on: boolean): void {
  write(MUSIC_KEY, on ? 'on' : 'off');
}

export function readVolume(): number {
  const v = Number(read(VOLUME_KEY));
  return read(VOLUME_KEY) != null && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
}

export function writeVolume(v: number): void {
  write(VOLUME_KEY, String(Math.max(0, Math.min(1, v))));
}

/**
 * Whether this person hears the music: their own choice once they've made one; until then only
 * the person who started the timer (they chose it). Everyone else starts muted and turns it on.
 */
export function hearsMusic(pref: boolean | null, startedBy: string | null | undefined, me: string): boolean {
  return pref ?? startedBy === me;
}
