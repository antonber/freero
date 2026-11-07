// Recording a walkthrough: the browser's own MediaRecorder over the microphone (and camera), plus
// the timeline of where the narrator looks and points. No screen capture and no recording service:
// the bytes go from this browser to Freero's uploads, nowhere else.
//
// Several presenters (#128): the host's recording is a SESSION others on the board can be invited
// into (presence). Each who joins records their own voice, view and pointer in their own browser,
// on the walkthrough's clock (the server clock: the host's start is 0), and sends it as a voice of
// the session when the host stops — or when they leave early; the recording goes on without them.
// Nobody's audio travels between browsers: people present together on whatever call they're on.
//
// One recording at a time per tab; the state is a tiny external store the recorder overlay and
// the start dialog read with useRecorder().
import { useSyncExternalStore } from 'react';
import { nanoid } from 'nanoid';
import { MAX_WALKTHROUGH_MS, MAX_WALKTHROUGH_TITLE, WALKTHROUGH_SESSION_RE, type PresenceState } from '@freero/shared';
import type { Editor } from '@engine';
import { SpeechTracker, TimelineRecorder, type Pt, type ViewRect } from './timeline';
import { openWalkthrough } from './playback';

import { t as tr } from '../messages';
export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'saving';

/** What a recording presenter shows the others on the board (presence `ext.walkthrough`). */
export interface RecordingPresence {
  session: string;
  title: string;
  /** Server-clock ms when the host's recording started: the walkthrough's 0. */
  startedAt: number;
  host: boolean;
  /** The host: people invited to join. */
  invited?: string[];
  /** The host, for a few seconds after stopping: whether it was kept. */
  ended?: 'saved' | 'discarded';
}

export interface GroupState {
  session: string;
  role: 'host' | 'guest';
  hostId: string;
  hostName: string;
  /** Server-clock ms of the walkthrough's 0. */
  startedAtServer: number;
  /** The host: who was invited. */
  invited: string[];
  /** A guest: where their recording starts on the walkthrough's clock. */
  offsetMs: number;
}

export interface RecorderState {
  phase: RecorderPhase;
  /** Recording the camera too (the bubble). */
  camera: boolean;
  stream: MediaStream | null;
  /** performance.now() when the recorder started (the timeline's 0). */
  startedAt: number;
  title: string;
  error: string | null;
  /** [#128] The session this recording is part of (always set while recording). */
  group: GroupState | null;
}

const IDLE: RecorderState = { phase: 'idle', camera: false, stream: null, startedAt: 0, title: '', error: null, group: null };
let state: RecorderState = IDLE;
const listeners = new Set<() => void>();
const set = (patch: Partial<RecorderState>) => {
  state = { ...state, ...patch };
  for (const l of [...listeners]) l();
};

export function useRecorder(): RecorderState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** The browser can record here at all (a secure page with MediaRecorder and media devices). */
export const canRecord = (): boolean =>
  typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext !== false;

const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const pick = (types: string[]) => types.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';

/** The narrator's view: the world rectangle their screen shows. */
export function viewRectOf(editor: Editor): ViewRect {
  const cam = editor.getCamera();
  const size = editor.getViewportSize();
  return { x: cam.x, y: cam.y, w: size.width / cam.zoom, h: size.height / cam.zoom };
}

let session: {
  editor: Editor;
  recorder: MediaRecorder;
  chunks: Blob[];
  timeline: TimelineRecorder;
  speech: SpeechTracker;
  stopLevels: () => void;
  off: () => void;
  limit: ReturnType<typeof setTimeout>;
} | null = null;

const now = () => performance.now();

function message(e: unknown, camera: boolean): string {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return tr('freeroCanTUseYour', { value: camera ? tr('microphoneAndCamera') : tr('microphone') });
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return camera ? tr('noCameraOrMicrophoneWas') : tr('noMicrophoneWasFoundPlug');
  if (name === 'NotReadableError') return tr('anotherAppIsUsingYour');
  return tr('recordingCouldnTStartIn');
}

/** Microphone levels → when this person talked (who playback follows with several presenters). */
function trackLevels(stream: MediaStream, speech: SpeechTracker, startedAt: () => number): () => void {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor || !stream.getAudioTracks().length) return () => undefined;
  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return () => undefined;
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const src = ctx.createMediaStreamSource(stream);
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const id = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    speech.level(now() - startedAt(), Math.sqrt(sum / buf.length));
  }, 100);
  return () => {
    clearInterval(id);
    src.disconnect();
    void ctx.close().catch(() => undefined);
  };
}

function publish(editor: Editor, p: RecordingPresence | null): void {
  editor.setPresenceExt(p);
}

function hostPresence(g: GroupState, title: string, ended?: RecordingPresence['ended']): RecordingPresence {
  return { session: g.session, title, startedAt: g.startedAtServer, host: g.role === 'host', ...(g.role === 'host' ? { invited: g.invited } : {}), ...(ended ? { ended } : {}) };
}

/** The start in progress: its board may close before the browser hands over the devices. */
let starting: { editor: Editor; abandoned: boolean } | null = null;

const release = (stream: MediaStream | null) => {
  for (const t of stream?.getTracks() ?? []) t.stop();
};

/** How long MediaRecorder may take to start before the attempt counts as failed. */
const START_TIMEOUT_MS = 10_000;

/** Starts the recorder: it fires `start`, or it threw, fired `error` or never started. */
function startRecorder(recorder: MediaRecorder): Promise<{ ok: true } | { ok: false; error: unknown }> {
  return new Promise((resolve) => {
    const done = (r: { ok: true } | { ok: false; error: unknown }) => {
      clearTimeout(timer);
      recorder.onstart = null;
      recorder.onerror = null;
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, error: null }), START_TIMEOUT_MS);
    recorder.onstart = () => done({ ok: true });
    recorder.onerror = (e) => done({ ok: false, error: (e as Event & { error?: unknown }).error ?? e });
    try {
      recorder.start(1000);
    } catch (error) {
      done({ ok: false, error });
    }
  });
}

/**
 * Asks for the devices and starts recording: as the host of a new session, or joining `join`.
 * Every way out but a running recording gives the devices back and returns to idle, and so does
 * the board closing meanwhile (endRecordingWithBoard).
 */
async function begin(editor: Editor, opts: { title: string; camera: boolean; join?: { session: string; hostId: string; hostName: string; startedAt: number } }): Promise<boolean> {
  if (state.phase !== 'idle') return false;
  if (!canRecord()) {
    set({ error: tr('thisBrowserCanTRecord') });
    return false;
  }
  set({ ...IDLE, phase: 'starting', camera: opts.camera, title: opts.title });
  const attempt = { editor, abandoned: false };
  starting = attempt;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let camera = opts.camera;
  // Gone back to idle without recording: nothing keeps the devices. No message once the board is gone.
  const fail = (error: string | null): false => {
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      // Already stopping: ending its tracks ends it either way.
    }
    release(stream);
    set({ ...IDLE, error: attempt.abandoned ? null : error });
    return false;
  };
  try {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: camera ? { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: 'user' } : false,
      });
    } catch (e) {
      // The camera alone may be the problem: the voice is what matters.
      if (!camera || attempt.abandoned) return fail(message(e, false));
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        camera = false;
        if (!attempt.abandoned) editor.host.notify(tr('theCameraIsnTAvailable'), 'info');
      } catch (e2) {
        return fail(message(e2, false));
      }
    }
    if (attempt.abandoned) return fail(null);
    const mimeType = pick(camera ? VIDEO_TYPES : AUDIO_TYPES);
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000, ...(camera ? { videoBitsPerSecond: 350_000 } : {}) });
    recorder = rec;
    const timeline = new TimelineRecorder();
    const speech = new SpeechTracker();
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const started = await startRecorder(rec);
    if (!started.ok) return fail(message(started.error, camera));
    if (attempt.abandoned) return fail(null);
    const startedAt = now();
    const serverStart = editor.host.serverNow();
    const group: GroupState = opts.join
      ? {
          session: opts.join.session,
          role: 'guest',
          hostId: opts.join.hostId,
          hostName: opts.join.hostName,
          startedAtServer: opts.join.startedAt,
          invited: [],
          offsetMs: Math.max(0, Math.round(serverStart - opts.join.startedAt)),
        }
      : { session: nanoid(16), role: 'host', hostId: editor.user.id, hostName: editor.user.name, startedAtServer: serverStart, invited: [], offsetMs: 0 };
    timeline.view(0, viewRectOf(editor));
    const off = editor.on('camera', () => timeline.view(now() - startedAt, viewRectOf(editor)));
    const limit = setTimeout(() => void stopRecording(true), Math.max(1000, MAX_WALKTHROUGH_MS - group.offsetMs));
    const stopLevels = trackLevels(stream, speech, () => startedAt);
    session = { editor, recorder: rec, chunks, timeline, speech, stopLevels, off, limit };
    // A track ending (camera unplugged, permission revoked) or the recorder failing ends the
    // recording, kept so far.
    for (const t of stream.getTracks()) t.addEventListener('ended', () => void stopRecording(true), { once: true });
    rec.onerror = () => void stopRecording(true);
    set({ phase: 'recording', stream, camera, startedAt, group });
    publish(editor, hostPresence(group, opts.title));
    return true;
  } catch (e) {
    return fail(message(e, camera));
  } finally {
    if (starting === attempt) starting = null;
  }
}

/**
 * The board this recording is on is closing (its recording overlay unmounts with it): the
 * recording ends with it and nothing is kept. Keeping is a choice the person makes with "Stop and
 * save"; leaving is not that choice, and nothing may go on listening, or be published to the
 * board, once its controls are gone. A start still waiting for the devices hands them back as soon
 * as they arrive. A recording on another board (another editor) is left alone.
 */
export function endRecordingWithBoard(editor: Editor): void {
  if (starting?.editor === editor) starting.abandoned = true;
  if (session?.editor !== editor) return;
  editor.host.notify(tr('youLeftTheBoardSoThe'), 'info');
  void stopRecording(false);
}

/** Starts recording as the host of a new session (others can be invited while it runs). */
export function startRecording(editor: Editor, opts: { title: string; camera: boolean }): Promise<boolean> {
  return begin(editor, opts);
}

/** Joins someone's recording: records this person's own voice, view and pointer for it. */
export function joinRecording(editor: Editor, host: { userId: string; name: string; presence: RecordingPresence }, opts: { camera: boolean }): Promise<boolean> {
  if (!WALKTHROUGH_SESSION_RE.test(host.presence.session)) return Promise.resolve(false);
  return begin(editor, {
    title: host.presence.title.slice(0, MAX_WALKTHROUGH_TITLE),
    camera: opts.camera,
    join: { session: host.presence.session, hostId: host.userId, hostName: host.name, startedAt: host.presence.startedAt },
  });
}

/** The host invites someone on the board into the recording, or takes the invitation back. */
export function setInvited(userId: string, invited: boolean): void {
  const g = state.group;
  if (!session || !g || g.role !== 'host' || state.phase !== 'recording') return;
  const list = invited ? [...new Set([...g.invited, userId])] : g.invited.filter((u) => u !== userId);
  const next = { ...g, invited: list };
  set({ group: next });
  publish(session.editor, hostPresence(next, state.title));
}

/** Where the narrator's pointer is (world), or null off the board: the overlay reports it. */
export function notePointer(p: Pt | null): void {
  if (session && state.phase === 'recording') session.timeline.pointer(now() - state.startedAt, p);
}

/** How long the host's "it was kept / thrown away" stays in presence for the others to see. */
const ENDED_NOTICE_MS = 10_000;

/** Stops; `save` keeps it (the host: as a walkthrough on the board; a guest: as their voice in it). */
export async function stopRecording(save: boolean): Promise<void> {
  const s = session;
  if (!s || state.phase !== 'recording') return;
  session = null;
  s.off();
  s.stopLevels();
  clearTimeout(s.limit);
  const group = state.group;
  const durationMs = Math.min(MAX_WALKTHROUGH_MS, Math.round(now() - state.startedAt));
  const { title, camera, stream } = state;
  const kept = save && durationMs >= 500;
  // The others recording with the host stop with it (and keep their voice only if the host kept
  // theirs). Said before waiting for the recorder: the board may be closing.
  if (group?.role === 'host') {
    publish(s.editor, hostPresence(group, title, kept ? 'saved' : 'discarded'));
    setTimeout(() => {
      if (state.phase !== 'recording') publish(s.editor, null); // unless a new recording has started since
    }, ENDED_NOTICE_MS);
  } else publish(s.editor, null);
  // A recorder that already stopped by itself (it failed, or every track ended) fires no more `stop`.
  const stopped = new Promise<void>((resolve) => {
    s.recorder.onstop = () => resolve();
    if (s.recorder.state === 'inactive') resolve();
  });
  s.recorder.onerror = null;
  if (s.recorder.state !== 'inactive') s.recorder.stop();
  if (!kept) release(stream); // nothing to wait for: the devices go now
  await stopped;
  release(stream);
  if (!kept) {
    set(IDLE);
    if (save) s.editor.host.notify(tr('thatWasTooShortTo'), 'info');
    return;
  }
  set({ phase: 'saving', stream: null });
  const type = s.recorder.mimeType || (camera ? 'video/webm' : 'audio/webm');
  const blob = new Blob(s.chunks, { type: type.split(';')[0] });
  const media = camera ? 'video' : 'audio';
  const timeline = { ...s.timeline.finish(durationMs), speech: s.speech.finish(durationMs) };
  const walkthroughs = s.editor.host.walkthroughs;
  try {
    if (!walkthroughs) throw new Error('Walkthroughs need a Freero server.');
    if (group?.role === 'guest') {
      if (!walkthroughs.addVoice) throw new Error('Walkthroughs need a Freero server.');
      await walkthroughs.addVoice(blob, { session: group.session, media, offsetMs: group.offsetMs, durationMs, timeline });
      set(IDLE);
      s.editor.host.notify(tr('yourPartIsSaved', { name: group.hostName }), 'success');
      return;
    }
    const w = await walkthroughs.create(blob, { title, media, durationMs, timeline, ...(group ? { session: group.session } : {}) });
    set(IDLE);
    s.editor.host.notify(tr('savedTitle', { title: w.title }), 'success', { action: { label: tr('watch'), run: () => void openWalkthrough(s.editor, w.id) } });
  } catch (e) {
    set(IDLE);
    s.editor.host.notify(e instanceof Error && e.message ? tr('theWalkthroughCouldnTBe', { message: e.message }) : tr('theWalkthroughCouldnTBe2'), 'error');
  }
}

/** A recording presenter's presence on the board, if they are one. */
export function recordingOf(peer: Pick<PresenceState, 'ext'>): RecordingPresence | null {
  const p = (peer.ext as Record<string, unknown> | undefined)?.walkthrough as Partial<RecordingPresence> | null | undefined;
  if (!p || typeof p.session !== 'string' || typeof p.startedAt !== 'number' || typeof p.title !== 'string') return null;
  return { session: p.session, title: p.title, startedAt: p.startedAt, host: p.host === true, invited: Array.isArray(p.invited) ? p.invited.filter((x): x is string => typeof x === 'string') : [], ...(p.ended === 'saved' || p.ended === 'discarded' ? { ended: p.ended } : {}) };
}

/**
 * A guest follows their host: when the host stops, so do they — keeping their voice only when the
 * host kept the recording. A host who is gone from the board (their tab closed) for a while ends it
 * too: there will be no walkthrough to add the voice to.
 */
let hostMissingSince: number | null = null;
const HOST_GONE_MS = 15_000;
export function followHost(peers: ReadonlyArray<PresenceState>): void {
  const g = state.group;
  if (!g || g.role !== 'guest' || state.phase !== 'recording') {
    hostMissingSince = null;
    return;
  }
  const host = peers.map((p) => (p.user.id === g.hostId ? recordingOf(p) : null)).find((p) => p?.session === g.session && p.host);
  if (host?.ended) {
    hostMissingSince = null;
    void stopRecording(host.ended === 'saved');
    return;
  }
  if (host) {
    hostMissingSince = null;
    return;
  }
  hostMissingSince ??= Date.now();
  if (Date.now() - hostMissingSince > HOST_GONE_MS) {
    hostMissingSince = null;
    session?.editor.host.notify(tr('hostLeftRecordingEnded', { name: g.hostName }), 'info');
    void stopRecording(false);
  }
}

export function clearRecorderError(): void {
  if (state.error) set({ error: null });
}
