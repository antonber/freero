import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PresenceState } from '@freero/shared';
import type { ElementDefinition, ToolDefinition } from '../api';
import type { EngineCore } from '../runtime/core';
import { followStep } from '../camera/follow';
import { boxDef, bundle, makeCore } from './harness';

let core: EngineCore;
afterEach(() => core?.destroy());

const Noop = () => null;

describe('fitting content into the part of the screen the chrome leaves free', () => {
  it('zoom-to-fit with the side dock open puts the content beside the dock, not under it', () => {
    core = makeCore({
      bundles: [
        bundle('boxes', {
          elements: [boxDef as ElementDefinition<any>],
          panels: [{ id: 'side', slot: 'dock-right', order: 0, Component: Noop }],
        }),
      ],
    });
    const id = core.editor.create({ type: 'sticky', x: 0, y: 0 } as never);
    core.editor.openDock('side');
    core.editor.zoomToFit([id], { animate: false });
    const area = core.editor.getSafeArea();
    const right = core.editor.worldToScreen({ x: 100, y: 0 }).x;
    const left = core.editor.worldToScreen({ x: 0, y: 0 }).x;
    expect(area.x + area.w).toBeLessThan(core.editor.getViewportSize().width - 300);
    expect(right).toBeLessThanOrEqual(area.x + area.w);
    expect((left + right) / 2).toBeCloseTo(area.x + area.w / 2, 0);
  });
});

describe('following someone', () => {
  const peer = (clientId: number, userId: string, viewport: PresenceState['viewport']): PresenceState => ({
    user: { id: userId, name: userId, color: '#000' },
    cursor: null,
    selection: [],
    viewport,
  });
  const join = (c: EngineCore, clientId: number, state: PresenceState) => c.store.awareness.states.set(clientId, state);
  const leave = (c: EngineCore, clientId: number) => c.store.awareness.states.delete(clientId);
  /** World rect visible on a screen of `w × h` with camera `c`. */
  const visible = (c: { x: number; y: number; zoom: number }, w: number, h: number) => ({ x0: c.x, y0: c.y, x1: c.x + w / c.zoom, y1: c.y + h / c.zoom });

  it('shows everything they see on a smaller screen, and lets go as soon as you move the camera yourself', () => {
    core = makeCore(); // 1000 × 800
    const theirs = { x: 100, y: 50, zoom: 2, width: 1600, height: 1000 };
    join(core, 77, peer(77, 'zoe', theirs));
    core.editor.follow({ userId: 'zoe' });
    for (let i = 0; i < 200; i++) followStep(core);
    expect(core.editor.getFollowing()).toEqual({ userId: 'zoe', clientId: undefined });
    const mine = visible(core.editor.getCamera(), 1000, 800);
    const them = visible(theirs, 1600, 1000);
    expect(mine.x0).toBeLessThanOrEqual(them.x0 + 0.5);
    expect(mine.y0).toBeLessThanOrEqual(them.y0 + 0.5);
    expect(mine.x1).toBeGreaterThanOrEqual(them.x1 - 0.5);
    expect(mine.y1).toBeGreaterThanOrEqual(them.y1 - 0.5);

    let userMoves = 0;
    core.editor.on('camera-user', () => userMoves++);
    const cam = core.editor.getCamera();
    core.editor.asUser(() => core.editor.setCameraNow({ ...cam, x: cam.x + 40 })); // a wheel scroll
    expect(userMoves).toBe(1);
    expect(core.editor.getFollowing()).toBeNull();
    followStep(core);
    expect(core.editor.getCamera().x).toBe(cam.x + 40);
  });

  it("a facilitator's follow-me pulls the view back after you pan, survives Esc, Stop and their brief absence, and ends only on release", () => {
    core = makeCore();
    join(core, 77, peer(77, 'lead', { x: 0, y: 0, zoom: 1, width: 1000, height: 800 }));
    core.editor.follow({ userId: 'lead', locked: true }, { force: true });
    const cam = core.editor.getCamera();
    core.editor.asUser(() => core.editor.setCameraNow({ ...cam, x: cam.x + 900 })); // wandering off
    core.editor.follow(null); // Esc, a canvas click, presence's "Stop"
    for (let i = 0; i < 200; i++) followStep(core);
    expect(core.editor.getCamera().x).toBeCloseTo(0, 0);
    leave(core, 77);
    followStep(core);
    expect(core.editor.getFollowing()?.userId).toBe('lead');

    core.editor.follow(null, { force: true });
    core.editor.asUser(() => core.editor.setCameraNow({ ...core.editor.getCamera(), x: 900 }));
    followStep(core);
    expect(core.editor.getCamera().x).toBe(900);
  });

  it('switches to their other tab when the followed tab closes, and stops when they leave the board', () => {
    core = makeCore();
    join(core, 5, peer(5, 'zoe', { x: 0, y: 0, zoom: 1, width: 1000, height: 800 }));
    join(core, 6, peer(6, 'zoe', { x: 5000, y: 0, zoom: 1, width: 1000, height: 800 }));
    core.editor.follow({ userId: 'zoe', clientId: 5 });
    leave(core, 5);
    for (let i = 0; i < 200; i++) followStep(core);
    expect(core.editor.getCamera().x).toBeCloseTo(5000, 0);
    leave(core, 6);
    followStep(core);
    expect(core.editor.getFollowing()).toBeNull();
  });
});

describe('act-now tools', () => {
  it('picking one runs it once and keeps the tool you were using', () => {
    let ran = 0;
    const upload: ToolDefinition = { id: 'upload', label: 'Upload', icon: Noop, order: 9, placement: 'main', onSelect: () => ran++ };
    const draw: ToolDefinition = { id: 'draw', label: 'Draw', icon: Noop, order: 8, placement: 'main' };
    core = makeCore({ bundles: [bundle('t', { tools: [draw, upload] })] });
    core.editor.setTool('draw');
    core.editor.setTool('upload');
    expect(ran).toBe(1);
    expect(core.editor.getToolId()).toBe('draw');
  });
});

describe('zoom steps', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('pressing zoom-out three times in quick succession zooms out three steps, not one', () => {
    core = makeCore();
    vi.useFakeTimers({ toFake: ['performance'] });
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (frames.set(++next, cb), next));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const tick = () => {
      vi.advanceTimersByTime(16);
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb(performance.now());
    };
    core.editor.setCamera({ x: 0, y: 0, zoom: 1 });
    // Each press lands while the previous zoom animation is still running.
    for (let i = 0; i < 3; i++) {
      core.editor.runCommand('engine.zoomOut');
      tick();
    }
    for (let i = 0; i < 50 && frames.size; i++) tick();
    expect(core.editor.getCamera().zoom).toBe(0.5); // 100% → 75% → 67% → 50%
  });
});
