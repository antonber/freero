// Following someone's view (Editor.follow): while ui.following is set, every frame eases this
// client's camera toward a camera that shows everything the followed tab sees. Any other camera
// write (wheel, pan, zoom, a feature's setCamera) ends it — see EditorImpl.cameraChanged — and so
// does the person leaving. Not this tab's own connection dropping: everyone's presence goes with it
// (y-websocket forgets all of it on a close), so following waits for the reconnect and a moment
// after it (PRESENCE_RESYNC_MS) for their presence to come back.
import type { Camera, FollowTarget } from '../api';
import type { EngineCore } from '../runtime/core';
import { fitRect, lerpCamera, MAX_ZOOM } from './camera';
import { prefersReducedMotion } from './motion';

type Peer = ReturnType<EngineCore['store']['getPeers']>[number];

/** Share of the remaining distance covered per frame: smooth, yet only a few frames behind. */
const STEP = 0.25;
const linear = (t: number) => t;
/**
 * After this tab's connection comes back, how long a followed person's missing presence still means
 * "not here yet" (another instance's presence can follow the sync) rather than "left".
 */
export const PRESENCE_RESYNC_MS = 3000;

/** When each board's connection last became live (connected and synced); see installFollow. */
const liveSince = new WeakMap<EngineCore, number>();

/** Can a peer missing from presence be taken as gone? Not while our own connection is down or just back. */
function presenceSettled(core: EngineCore, now: number): boolean {
  const { connection, synced } = core.ui.getState();
  if (connection === 'connecting' || connection === 'disconnected' || (connection === 'connected' && !synced)) return false;
  return connection !== 'connected' || now - (liveSince.get(core) ?? -Infinity) >= PRESENCE_RESYNC_MS;
}

/** The tab to mirror: the pinned one while it's here, else the user's tab that has a view (newest first). */
export function followedClient(peers: Peer[], target: FollowTarget): Peer | null {
  const mine = peers.filter((p) => p.user?.id === target.userId);
  const pinned = target.clientId !== undefined ? mine.find((p) => p.clientId === target.clientId) : undefined;
  if (pinned?.viewport) return pinned;
  let best: Peer | null = pinned ?? null;
  for (const p of mine) if (p.viewport && (!best?.viewport || p.clientId > best.clientId)) best = p;
  return best;
}

/** Camera showing all of `view` (their whole screen) in a viewport of `size`, same center. */
export function cameraShowing(view: NonNullable<Peer['viewport']>, size: { width: number; height: number }): Camera {
  return fitRect({ x: view.x, y: view.y, w: view.width / view.zoom, h: view.height / view.zoom }, size, 0, MAX_ZOOM);
}

const close = (a: Camera, b: Camera) =>
  Math.abs(a.x - b.x) * a.zoom < 0.25 && Math.abs(a.y - b.y) * a.zoom < 0.25 && Math.abs(a.zoom / b.zoom - 1) < 1e-3;

/** One frame of following. Returns false once there is nobody left to follow (and stops). */
export function followStep(core: EngineCore, now = Date.now()): boolean {
  const target = core.ui.getState().following;
  if (!target) return false;
  const peers = core.store.getPeers();
  const client = followedClient(peers, target);
  if (!client) {
    if (target.locked) return true; // a facilitator's "follow me": wait for them to come back
    if (!presenceSettled(core, now)) return true; // our own connection blipped: theirs comes back with it
    core.editor.follow(null);
    return false;
  }
  if (!client.viewport) return true; // just joined: wait for their first view
  const size = core.editor.getViewportSize();
  const goal = cameraShowing(client.viewport, size);
  const cur = core.editor.getCamera();
  if (!close(cur, goal)) core.editor.applyFollowCamera(prefersReducedMotion() ? goal : lerpCamera(cur, goal, STEP, size, linear));
  return true;
}

/** Runs followStep every animation frame while following. Returns the disposer. */
export function installFollow(core: EngineCore): () => void {
  let raf = 0;
  const loop = () => {
    raf = followStep(core) ? requestAnimationFrame(loop) : 0;
  };
  const off = core.ui.subscribe((s, prev) => {
    if (s.connection === 'connected' && s.synced && !(prev.connection === 'connected' && prev.synced)) liveSince.set(core, Date.now());
    if (s.following === prev.following) return;
    core.emitter.emit('follow');
    if (s.following && !raf && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(loop);
  });
  return () => {
    off();
    if (raf) cancelAnimationFrame(raf);
  };
}
