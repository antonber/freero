// Plays ./music.ts's score with the Web Audio API, following the shared timer's position (#145).
// A look-ahead scheduler: a few times a second it schedules the notes of the next moments on the
// AudioContext clock, anchored to the timer's elapsed time (server clock). If the two drift apart —
// a pause, a resume, the clock correcting itself — it re-anchors and starts from the notes that
// are sounding now, so it can never fall out of step with everyone else.
import { audio } from './audio';
import { notesBetween, type MusicTrack, type NoteEvent } from './music';

const LOOKAHEAD_MS = 1500;
const TICK_MS = 300;
/** Re-anchor when the audio clock and the timer disagree by more than this. */
const MAX_DRIFT_MS = 350;

interface Playing {
  track: MusicTrack;
  /** Elapsed timer ms, now. */
  position: () => number;
  /** Where the music ends (the timer's length): nothing is scheduled past it. */
  endMs: () => number;
  anchorCtx: number;
  anchorPos: number;
  scheduledUntil: number;
  bus: GainNode;
  sources: Set<AudioScheduledSourceNode>;
}

export class MusicPlayer {
  private playing: Playing | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.5;

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    const c = audio();
    if (c && this.master) this.master.gain.setTargetAtTime(this.volume, c.currentTime, 0.08);
  }

  /** Starts `track` (or keeps it going) following `position`. Safe to call on every render. */
  play(track: MusicTrack, position: () => number, endMs: () => number): void {
    const c = audio();
    if (!c) return;
    if (c.state === 'suspended') void c.resume();
    if (this.playing?.track === track) {
      this.playing.position = position;
      this.playing.endMs = endMs;
      return;
    }
    this.stop();
    const bus = c.createGain();
    bus.connect(this.out(c));
    this.playing = { track, position, endMs, anchorCtx: 0, anchorPos: 0, scheduledUntil: 0, bus, sources: new Set() };
    this.anchor(c, this.playing);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Fades out what is sounding and stops scheduling. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const p = this.playing;
    this.playing = null;
    const c = audio();
    if (p && c) this.release(c, p, 0.6);
  }

  private out(c: AudioContext): GainNode {
    if (!this.master) {
      this.master = c.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(c.destination);
    }
    return this.master;
  }

  private release(c: AudioContext, p: Playing, seconds: number) {
    const t = c.currentTime;
    p.bus.gain.cancelScheduledValues(t);
    p.bus.gain.setValueAtTime(p.bus.gain.value, t);
    p.bus.gain.linearRampToValueAtTime(0, t + seconds);
    for (const s of p.sources) {
      try {
        s.stop(t + seconds + 0.05);
      } catch {
        /* already stopped */
      }
    }
    setTimeout(() => p.bus.disconnect(), (seconds + 0.2) * 1000);
  }

  /** Pins timer position `now` to the audio clock and schedules what is sounding from there. */
  private anchor(c: AudioContext, p: Playing) {
    for (const s of p.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    p.sources.clear();
    p.anchorCtx = c.currentTime + 0.05;
    p.anchorPos = p.position();
    p.scheduledUntil = p.anchorPos;
    p.bus.gain.cancelScheduledValues(c.currentTime);
    p.bus.gain.setValueAtTime(0, c.currentTime);
    p.bus.gain.linearRampToValueAtTime(1, c.currentTime + 1.2); // come in softly, never with a click
    this.schedule(c, p, true);
  }

  private tick() {
    const c = audio();
    const p = this.playing;
    if (!c || !p) return;
    if (c.state !== 'running') return; // waiting for a gesture; anchor again once it plays
    const expected = p.anchorPos + (c.currentTime - p.anchorCtx) * 1000;
    if (Math.abs(expected - p.position()) > MAX_DRIFT_MS) this.anchor(c, p);
    else this.schedule(c, p, false);
  }

  private schedule(c: AudioContext, p: Playing, sounding: boolean) {
    const now = p.position();
    const to = Math.min(now + LOOKAHEAD_MS, p.endMs());
    if (to <= p.scheduledUntil) return;
    for (const n of notesBetween(p.track, p.scheduledUntil, to, sounding)) this.voice(c, p, n);
    p.scheduledUntil = to;
  }

  private voice(c: AudioContext, p: Playing, n: NoteEvent) {
    const at = p.anchorCtx + (n.at - p.anchorPos) / 1000;
    const end = at + n.dur / 1000;
    const start = Math.max(at, c.currentTime + 0.01);
    if (end <= start + 0.05) return;
    const g = c.createGain();
    g.connect(p.bus);
    const level = n.gain;
    if (n.voice === 'pad' || n.voice === 'noise') {
      const attack = n.voice === 'pad' ? 1.6 : 0.8;
      const rel = n.voice === 'pad' ? 2.2 : 0.8;
      g.gain.setValueAtTime(0.0001, start);
      // Joining mid-note: come straight in at the level the note would have reached.
      g.gain.linearRampToValueAtTime(level, Math.max(start + 0.3, at + attack));
      g.gain.setValueAtTime(level, Math.max(start + 0.31, end - rel));
      g.gain.linearRampToValueAtTime(0.0001, end);
    } else {
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(level, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
    }
    const sources: AudioScheduledSourceNode[] = [];
    if (n.voice === 'noise') {
      const src = c.createBufferSource();
      src.buffer = this.noiseBuffer(c);
      src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = n.freq;
      src.connect(lp).connect(g);
      sources.push(src);
    } else {
      const partials: Array<[OscillatorType, number, number]> =
        n.voice === 'pad'
          ? [['triangle', 1, 0.7], ['sine', 1.0023, 0.5]] // two slightly detuned voices: a slow, warm beat
          : n.voice === 'bell'
            ? [['sine', 1, 1], ['sine', 2.01, 0.12]]
            : [['triangle', 1, 1]];
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = n.voice === 'pad' ? 1600 : 3200;
      lp.connect(g);
      for (const [type, mult, amp] of partials) {
        const osc = c.createOscillator();
        osc.type = type;
        osc.frequency.value = n.freq * mult;
        const a = c.createGain();
        a.gain.value = amp;
        osc.connect(a).connect(lp);
        sources.push(osc);
      }
    }
    for (const s of sources) {
      p.sources.add(s);
      s.onended = () => {
        p.sources.delete(s);
        s.disconnect();
      };
      s.start(start);
      s.stop(end + 0.05);
    }
  }

  private noiseBuffer(c: AudioContext): AudioBuffer {
    if (this.noise && this.noise.sampleRate === c.sampleRate) return this.noise;
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    // Brown-ish noise (integrated white noise): softer than hiss, closer to rain on a window.
    let last = 0;
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const white = seed / 2147483648 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    this.noise = buf;
    return buf;
  }
}
