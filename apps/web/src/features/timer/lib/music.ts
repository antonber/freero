// Background music for the shared timer (#145): original ambient pieces GENERATED here, note by
// note — no audio files, no third-party recordings or samples. The score is a pure function of
// (track, elapsed timer time), so every client playing it hears the same chord at the same moment
// (the timer's position comes from the server clock), a late joiner comes in where everyone is,
// and a pause or "+1 min" carries on where the music stopped. ./musicPlayer.ts turns the notes
// into sound with the Web Audio API.

export const MUSIC_TRACKS = ['drift', 'pulse', 'rain'] as const;
export type MusicTrack = (typeof MUSIC_TRACKS)[number];

export function isMusicTrack(v: unknown): v is MusicTrack {
  return typeof v === 'string' && (MUSIC_TRACKS as readonly string[]).includes(v);
}

/** pad: soft sustained chord; pluck: short decaying note; bell: sine with an overtone; noise: a filtered hiss (rain). */
export type Voice = 'pad' | 'pluck' | 'bell' | 'noise';

export interface NoteEvent {
  /** Start, in ms of elapsed timer time. */
  at: number;
  /** Length in ms (the envelope's release ends here). */
  dur: number;
  /** Hz; for `noise`, the low-pass cutoff. */
  freq: number;
  /** Peak level before the listener's own volume (0..1, kept low: this sits under talk). */
  gain: number;
  voice: Voice;
}

type BarNote = Omit<NoteEvent, 'at'> & { offset: number };

interface TrackDef {
  barMs: number;
  /** Chords as MIDI note numbers, one per bar, cycling. */
  chords: number[][];
  bar(chord: number[], rnd: () => number): BarNote[];
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

const TRACKS: Record<MusicTrack, TrackDef> = {
  // Slow major-seventh pads with a few high bell notes drifting over them.
  drift: {
    barMs: 8000,
    chords: [
      [48, 55, 59, 64], // Cmaj7
      [45, 52, 55, 60], // Am7
      [41, 48, 52, 57], // Fmaj7
      [43, 50, 55, 59], // G
    ],
    bar(chord, rnd) {
      const notes: BarNote[] = chord.map((m) => ({ offset: 0, dur: 9500, freq: hz(m), gain: 0.11, voice: 'pad' }));
      const scale = [72, 74, 76, 79, 81];
      for (let beat = 0; beat < 8; beat++) {
        if (rnd() < 0.3) {
          notes.push({ offset: beat * 1000 + Math.floor(rnd() * 200), dur: 2600, freq: hz(scale[Math.floor(rnd() * scale.length)]), gain: 0.05, voice: 'bell' });
        }
      }
      return notes;
    },
  },
  // A gentle plucked arpeggio over minor-ninth pads, steady enough to work to.
  pulse: {
    barMs: 4000,
    chords: [
      [50, 57, 60, 64], // Dm9 (no root doubling)
      [46, 53, 57, 62], // Bbmaj7
      [41, 48, 53, 57], // Fmaj7
      [48, 55, 57, 64], // C6
    ],
    bar(chord, rnd) {
      const notes: BarNote[] = chord.map((m) => ({ offset: 0, dur: 4400, freq: hz(m), gain: 0.06, voice: 'pad' }));
      notes.push({ offset: 0, dur: 1800, freq: hz(chord[0] - 12), gain: 0.09, voice: 'pluck' });
      notes.push({ offset: 2000, dur: 1800, freq: hz(chord[0] - 12), gain: 0.07, voice: 'pluck' });
      const tones = [...chord.slice(1).map((m) => m + 12), chord[1] + 24];
      const descending = rnd() < 0.4;
      for (let i = 0; i < 8; i++) {
        const k = descending ? tones.length - 1 - (i % tones.length) : i % tones.length;
        notes.push({ offset: i * 500, dur: 900, freq: hz(tones[k]), gain: i % 2 ? 0.035 : 0.05, voice: 'pluck' });
      }
      return notes;
    },
  },
  // Soft rain (filtered noise) over an open drone, with the odd drop of a high note.
  rain: {
    barMs: 6000,
    chords: [
      [45, 52, 57], // A open fifths
      [43, 50, 55], // G open fifths
    ],
    bar(chord, rnd) {
      const notes: BarNote[] = [
        { offset: 0, dur: 6800, freq: 1100, gain: 0.045, voice: 'noise' },
        ...chord.map((m): BarNote => ({ offset: 0, dur: 6800, freq: hz(m), gain: 0.07, voice: 'pad' })),
      ];
      const drops = [81, 84, 86, 88, 91];
      const count = Math.floor(rnd() * 4);
      for (let i = 0; i < count; i++) {
        notes.push({ offset: Math.floor(rnd() * 5600), dur: 1800, freq: hz(drops[Math.floor(rnd() * drops.length)]), gain: 0.03, voice: 'bell' });
      }
      return notes;
    },
  },
};

/** Small seeded PRNG (mulberry32): the same bar always gets the same "random" melody. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(track: MusicTrack, bar: number): number {
  let h = 2166136261;
  for (const ch of `${track}:${bar}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h;
}

function barNotes(track: MusicTrack, bar: number): NoteEvent[] {
  const def = TRACKS[track];
  const chord = def.chords[bar % def.chords.length];
  return def.bar(chord, rng(seedOf(track, bar))).map(({ offset, ...n }) => ({ ...n, at: bar * def.barMs + offset }));
}

/** The longest note any track holds, so a window can find notes that began bars earlier. */
const LONGEST_MS = 10_000;

/**
 * The notes of `track` that start in [fromMs, toMs) of elapsed timer time, in start order. With
 * `sounding`, also those that started earlier and still ring at `fromMs` (someone who arrives — or
 * turns the music on — mid-chord hears that chord at once). Asking for consecutive windows yields
 * every note exactly once.
 */
export function notesBetween(track: MusicTrack, fromMs: number, toMs: number, sounding = false): NoteEvent[] {
  if (!(toMs > fromMs)) return [];
  const { barMs } = TRACKS[track];
  const first = Math.max(0, Math.floor((fromMs - (sounding ? LONGEST_MS : 0)) / barMs));
  const last = Math.floor((toMs - 1) / barMs);
  const out: NoteEvent[] = [];
  for (let bar = first; bar <= last; bar++) {
    for (const n of barNotes(track, bar)) {
      if (n.at >= toMs) continue;
      if (n.at >= fromMs || (sounding && n.at + n.dur > fromMs)) out.push(n);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
