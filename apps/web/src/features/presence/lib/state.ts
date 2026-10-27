// Local (per board session) presence UI state, plus the one writer of ext.presence.
import { createStore, useStore, type StoreApi } from 'zustand';
import { nanoid } from 'nanoid';
import type { Editor, Point } from '@engine';
import { BURST_CAPACITY, takeToken, type Bucket, type PresenceExt, type Reaction, type Viewport } from './model';

export interface Burst {
  id: string;
  emoji: Reaction;
  /** Screen (viewport-relative) origin. */
  x: number;
  y: number;
  name: string;
  color: string;
}

export interface PresenceUi {
  bursts: Burst[];
  bucket: Bucket;
  ext: PresenceExt;
}

const stores = new WeakMap<Editor, StoreApi<PresenceUi>>();

/** The scoped presence Editor is cached per board session, so it keys the session state. */
export function presenceStore(editor: Editor): StoreApi<PresenceUi> {
  let s = stores.get(editor);
  if (!s) {
    s = createStore<PresenceUi>(() => ({
      bursts: [],
      bucket: { tokens: BURST_CAPACITY, at: Date.now() },
      ext: {},
    }));
    stores.set(editor, s);
  }
  return s;
}

export function usePresenceUi<T>(editor: Editor, sel: (s: PresenceUi) => T): T {
  return useStore(presenceStore(editor), sel);
}

function publish(editor: Editor, patch: Partial<PresenceExt>) {
  const store = presenceStore(editor);
  const ext = { ...store.getState().ext, ...patch };
  store.setState({ ext });
  editor.setPresenceExt(ext);
}

/**
 * Screen point a burst rises from: its world origin (kept on screen, so a reaction from
 * someone looking elsewhere still shows at the nearest edge), or the center of your screen.
 */
export function burstOrigin(editor: Editor, at: Point | null): Point {
  const s = editor.getViewportSize();
  if (!at) return { x: s.width / 2, y: s.height / 2 };
  const p = editor.worldToScreen(at);
  return { x: Math.min(Math.max(p.x, 40), s.width - 40), y: Math.min(Math.max(p.y, 100), s.height - 24) };
}

const BURST_LIFETIME_MS = 2200;
const MAX_LIVE_BURSTS = 24;

export function showBurst(editor: Editor, burst: Omit<Burst, 'id'>) {
  const store = presenceStore(editor);
  const id = nanoid(8);
  store.setState((s) => ({ bursts: [...s.bursts, { ...burst, id }].slice(-MAX_LIVE_BURSTS) }));
  setTimeout(() => store.setState((s) => ({ bursts: s.bursts.filter((b) => b.id !== id) })), BURST_LIFETIME_MS);
}

/**
 * Sends a reaction burst to everyone (and shows it locally). `at` is the world point it rises
 * from (your last pointer position on the canvas), or null for the screen center.
 * Returns false when throttled.
 */
export function sendReaction(editor: Editor, emoji: Reaction, at: Point | null): boolean {
  const store = presenceStore(editor);
  const { ok, bucket } = takeToken(store.getState().bucket, Date.now());
  store.setState({ bucket });
  if (!ok) return false;
  publish(editor, { reaction: { id: nanoid(10), emoji, at } });
  const origin = burstOrigin(editor, at);
  showBurst(editor, { emoji, x: origin.x, y: origin.y, name: editor.user.name, color: editor.user.color });
  return true;
}

export function bringEveryone(editor: Editor) {
  const cam = editor.getCamera();
  const size = editor.getViewportSize();
  publish(editor, { summon: { id: nanoid(10), viewport: { ...cam, ...size } } });
  editor.host.notify('Asked everyone to come to your view', 'success');
}

/** Shows exactly what someone sees (their whole screen fits yours), once. */
export function showView(editor: Editor, view: Viewport) {
  editor.zoomToRect({ x: view.x, y: view.y, w: view.width / view.zoom, h: view.height / view.zoom }, { padding: 0, area: 'viewport' });
}
