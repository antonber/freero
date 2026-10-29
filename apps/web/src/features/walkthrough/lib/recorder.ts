// Recording a walkthrough: the browser's own MediaRecorder over the microphone (and camera), plus
// the timeline of where the narrator looks and points. No screen capture and no recording service:
// the bytes go from this browser to Freero's uploads, nowhere else.
//
// One recording at a time per tab; the state is a tiny external store the recorder overlay and
// the start dialog read with useRecorder().
import { useSyncExternalStore } from 'react';
import { MAX_WALKTHROUGH_MS } from '@freero/shared';
import type { Editor } from '@engine';
import { TimelineRecorder, type Pt, type ViewRect } from './timeline';
import { openWalkthrough } from './playback';

export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'saving';

export interface RecorderState {
  phase: RecorderPhase;
  /** Recording the camera too (the bubble). */
  camera: boolean;
  stream: MediaStream | null;
  /** performance.now() when the recorder started (the timeline's 0). */
  startedAt: number;
  title: string;
  error: string | null;
}

const IDLE: RecorderState = { phase: 'idle', camera: false, stream: null, startedAt: 0, title: '', error: null };
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
  off: () => void;
  limit: ReturnType<typeof setTimeout>;
  save: boolean;
} | null = null;

const now = () => performance.now();

function message(e: unknown, camera: boolean): string {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return `Freero can’t use your ${camera ? 'microphone and camera' : 'microphone'}: your browser blocked it. Allow it for this site (the icon in the address bar) and try again.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return camera ? 'No camera or microphone was found.' : 'No microphone was found. Plug one in and try again.';
  if (name === 'NotReadableError') return 'Another app is using your microphone or camera.';
  return 'Recording couldn’t start in this browser.';
}

/** Asks for the microphone (and camera) and starts recording. Resolves once recording or refused. */
export async function startRecording(editor: Editor, opts: { title: string; camera: boolean }): Promise<boolean> {
  if (state.phase !== 'idle') return false;
  if (!canRecord()) {
    set({ error: 'This browser can’t record here. Use a current Chrome, Edge, Firefox or Safari over https.' });
    return false;
  }
  set({ ...IDLE, phase: 'starting', camera: opts.camera, title: opts.title });
  let stream: MediaStream;
  let camera = opts.camera;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: camera ? { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: 'user' } : false,
    });
  } catch (e) {
    // The camera alone may be the problem: the voice is what matters.
    if (camera) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        camera = false;
        editor.host.notify('The camera isn’t available, so this walkthrough records your voice only.', 'info');
      } catch (e2) {
        set({ ...IDLE, error: message(e2, false) });
        return false;
      }
    } else {
      set({ ...IDLE, error: message(e, false) });
      return false;
    }
  }
  const mimeType = pick(camera ? VIDEO_TYPES : AUDIO_TYPES);
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000, ...(camera ? { videoBitsPerSecond: 350_000 } : {}) });
  } catch (e) {
    for (const t of stream.getTracks()) t.stop();
    set({ ...IDLE, error: message(e, camera) });
    return false;
  }
  const timeline = new TimelineRecorder();
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  await new Promise<void>((resolve) => {
    recorder.onstart = () => resolve();
    recorder.start(1000);
  });
  const startedAt = now();
  timeline.view(0, viewRectOf(editor));
  const off = editor.on('camera', () => timeline.view(now() - startedAt, viewRectOf(editor)));
  const limit = setTimeout(() => void stopRecording(true), MAX_WALKTHROUGH_MS);
  session = { editor, recorder, chunks, timeline, off, limit, save: true };
  // The track ending (camera unplugged, permission revoked) ends the recording, kept so far.
  for (const t of stream.getTracks()) t.addEventListener('ended', () => void stopRecording(true), { once: true });
  set({ phase: 'recording', stream, camera, startedAt });
  return true;
}

/** Where the narrator's pointer is (world), or null off the board: the overlay reports it. */
export function notePointer(p: Pt | null): void {
  if (session && state.phase === 'recording') session.timeline.pointer(now() - state.startedAt, p);
}

/** Stops; `save` keeps it as a walkthrough on the board, otherwise it is thrown away. */
export async function stopRecording(save: boolean): Promise<void> {
  const s = session;
  if (!s || state.phase !== 'recording') return;
  session = null;
  s.off();
  clearTimeout(s.limit);
  const durationMs = Math.min(MAX_WALKTHROUGH_MS, Math.round(now() - state.startedAt));
  const { title, camera } = state;
  const stopped = new Promise<void>((resolve) => {
    s.recorder.onstop = () => resolve();
  });
  if (s.recorder.state !== 'inactive') s.recorder.stop();
  await stopped;
  for (const t of state.stream?.getTracks() ?? []) t.stop();
  if (!save || durationMs < 500) {
    set(IDLE);
    if (save) s.editor.host.notify('That was too short to keep.', 'info');
    return;
  }
  set({ phase: 'saving', stream: null });
  const type = s.recorder.mimeType || (camera ? 'video/webm' : 'audio/webm');
  const blob = new Blob(s.chunks, { type: type.split(';')[0] });
  const walkthroughs = s.editor.host.walkthroughs;
  try {
    if (!walkthroughs) throw new Error('Walkthroughs need a Freero server.');
    const w = await walkthroughs.create(blob, { title, media: camera ? 'video' : 'audio', durationMs, timeline: s.timeline.finish(durationMs) });
    set(IDLE);
    s.editor.host.notify(`Saved “${w.title}”`, 'success', { action: { label: 'Watch', run: () => void openWalkthrough(s.editor, w.id) } });
  } catch (e) {
    set(IDLE);
    s.editor.host.notify(e instanceof Error && e.message ? `The walkthrough couldn’t be saved: ${e.message}` : 'The walkthrough couldn’t be saved.', 'error');
  }
}

export function clearRecorderError(): void {
  if (state.error) set({ error: null });
}
