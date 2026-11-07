// @vitest-environment jsdom
// The recorder's hold on the microphone (and camera): it ends with the board it started on and with
// any failure on the way in, so the browser's recording indicator never outlives what the person sees.
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestBoard, type Editor, type FeatureBundle, type HostWalkthroughs, type PanelDefinition, type TestBoard } from '@engine';
import manifest from './feature';
import panels from './panel';
import { startRecording, stopRecording } from './lib/recorder';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bundle: FeatureBundle = { manifest, elements: [], tools: [], formats: [], panels: panels as PanelDefinition[], commands: [] };

// ---- the browser's devices, faked: every track handed out, and how the next recorder starts
let handedOut: Array<{ readyState: 'live' | 'ended' }> = [];
let nextStart: 'starts' | 'throws' | 'fires error' = 'starts';
let devices: () => Promise<MediaStream>;

function stream(): MediaStream {
  const track = {
    kind: 'audio',
    readyState: 'live' as 'live' | 'ended',
    stop() {
      this.readyState = 'ended';
    },
    addEventListener: () => undefined,
  };
  handedOut.push(track);
  return { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] } as unknown as MediaStream;
}

class FakeRecorder {
  static isTypeSupported = () => true;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  onstart: ((e: Event) => void) | null = null;
  onstop: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  start() {
    if (nextStart === 'throws') throw new DOMException('The stream is inactive', 'NotSupportedError');
    if (nextStart === 'fires error') {
      queueMicrotask(() => this.onerror?.(new Event('error')));
      return;
    }
    this.state = 'recording';
    queueMicrotask(() => this.onstart?.(new Event('start')));
  }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['x']) });
      this.onstop?.(new Event('stop'));
    });
  }
}

const live = () => handedOut.filter((t) => t.readyState === 'live').length;
const settle = () => act(async () => new Promise<void>((r) => setTimeout(r, 0)));

beforeEach(() => {
  handedOut = [];
  nextStart = 'starts';
  devices = async () => stream();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: () => devices() }, configurable: true });
});

let boards: TestBoard[] = [];
let roots: Root[] = [];
afterEach(async () => {
  await act(() => stopRecording(false)); // whatever a failing test left running
  for (const r of roots) act(() => r.unmount());
  for (const b of boards) b.destroy();
  roots = [];
  boards = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** A board open in the app: its recording overlay mounted as the board mounts it (StrictMode, as the app runs). */
function openBoard(): { editor: Editor; saved: ReturnType<typeof vi.fn>; close: () => void } {
  const board = createTestBoard({ users: ['ann'], features: [bundle] });
  boards.push(board);
  const [editor] = board.editors('walkthrough');
  const saved = vi.fn(async () => ({ id: 'w1', title: 'Walkthrough' }));
  (editor.host as { walkthroughs?: HostWalkthroughs }).walkthroughs = { create: saved } as unknown as HostWalkthroughs;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(<StrictMode>{board.panel(0, 'walkthrough.recording')}</StrictMode>));
  return { editor, saved, close: () => act(() => root.unmount()) };
}

/** Settles a recorder call inside act (the overlay re-renders as the phase changes). */
async function settled<T>(call: () => Promise<T>): Promise<T> {
  let out!: T;
  await act(async () => {
    out = await call();
  });
  return out;
}
const start = (editor: Editor) => settled(() => startRecording(editor, { title: 'Tour', camera: false }));

describe('leaving the board ends its recording', () => {
  it('closing the board while recording turns the microphone off and keeps nothing; the next board can record', async () => {
    const a = openBoard();
    expect(await start(a.editor)).toBe(true);
    expect(live()).toBe(1);

    a.close();
    await settle();

    expect(live()).toBe(0);
    expect(a.saved).not.toHaveBeenCalled();
    const b = openBoard();
    expect(await start(b.editor)).toBe(true);
  });

  it('closing the board while the browser is still asking for the microphone gives it back as soon as it arrives', async () => {
    const a = openBoard();
    let grant!: (s: MediaStream) => void;
    devices = () => new Promise((resolve) => (grant = resolve));
    let starting!: Promise<boolean>;
    act(() => void (starting = startRecording(a.editor, { title: 'Tour', camera: false })));

    a.close();
    grant(stream());

    expect(await settled(() => starting)).toBe(false);
    expect(live()).toBe(0);
    devices = async () => stream();
    const b = openBoard();
    expect(await start(b.editor)).toBe(true);
  });
});

describe('a recorder that won’t start', () => {
  it.each(['throws', 'fires error'] as const)('when MediaRecorder %s on start, the microphone is given back and the next try records', async (how) => {
    const a = openBoard();
    nextStart = how;
    expect(await start(a.editor)).toBe(false);
    expect(live()).toBe(0);

    nextStart = 'starts';
    expect(await start(a.editor)).toBe(true);
  });
});
