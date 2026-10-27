// Test harness: a real EngineCore (Yjs store, UI store, registry, editor, select tool) with
// minimal element definitions, plus pointer helpers that route exactly like the canvas does
// (beginGesture → tool handlers → endGesture).
import type { Role } from '@freero/shared';
import type { ElementDefinition, FeatureBundle, Host, Point, ToolPointerEvent } from '../api';
import { createCore, type EngineCore } from '../runtime/core';

const Noop = () => null;

export const boxDef: ElementDefinition<'sticky'> = {
  type: 'sticky',
  Component: Noop,
  resize: 'free',
  textField: 'text',
  defaults: () => ({
    type: 'sticky',
    w: 100,
    h: 100,
    color: 'yellow',
    text: '',
    fontFamily: 'sans',
    fontSize: 'auto',
    textColor: '#000',
    align: 'center',
    vAlign: 'middle',
  }),
};

export const frameDef: ElementDefinition<'frame'> = {
  type: 'frame',
  Component: Noop,
  resize: 'free',
  container: true,
  rotatable: false,
  defaults: () => ({ type: 'frame', w: 400, h: 300, title: 'Frame', fill: '#fff', index: 0 }),
};

export function bundle(name: string, extra: Partial<FeatureBundle> = {}): FeatureBundle {
  return { manifest: { name, description: name }, elements: [], tools: [], formats: [], panels: [], commands: [], ...extra };
}

export function makeHost(role: Role = 'owner'): Host {
  return {
    user: { id: 'u1', name: 'Tester', color: '#5b3ff0', avatarUrl: null },
    board: { id: 'test-board', title: 'Test', role },
    syncUrl: '',
    uploadImage: async () => ({ url: '' }),
    renameBoard: async () => undefined,
    saveThumbnail: async () => undefined,
    serverNow: () => Date.now(),
    openShareDialog: () => undefined,
    navigate: () => undefined,
    notify: () => undefined,
  };
}

export function makeCore(opts: { role?: Role; bundles?: FeatureBundle[] } = {}): EngineCore {
  const core = createCore(
    makeHost(opts.role),
    opts.bundles ?? [bundle('boxes', { elements: [boxDef as ElementDefinition<any>, frameDef as ElementDefinition<any>] })],
  );
  core.ui.setState({ viewport: { width: 1000, height: 800 }, camera: { x: 0, y: 0, zoom: 1 } });
  return core;
}

function toolEvent(core: EngineCore, world: Point, mods: { shift?: boolean; alt?: boolean } = {}, button = 0): ToolPointerEvent {
  const ev = {
    editor: core.editor,
    point: world,
    screen: core.editor.worldToScreen(world),
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    metaKey: false,
    button,
    pressure: 0.5,
    pointerType: 'mouse',
  } as unknown as ToolPointerEvent;
  Object.defineProperty(ev, 'target', { get: () => core.editor.hitTest(world) });
  return ev;
}

/** Drags with the select tool from → to in `steps` moves (world coords), like a real pointer. */
export function drag(
  core: EngineCore,
  from: Point,
  to: Point,
  opts: { shift?: boolean; alt?: boolean; handle?: string; steps?: number } = {},
) {
  const tool = core.registry.toolsById.get('select')!.def;
  core.interaction.handle = opts.handle ?? null;
  core.interaction.clickCount = 1;
  core.editor.beginGesture();
  tool.onPointerDown!(toolEvent(core, from, opts));
  const steps = opts.steps ?? 5;
  for (let i = 1; i <= steps; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    tool.onPointerMove!(toolEvent(core, p, opts));
  }
  tool.onPointerUp!(toolEvent(core, to, opts));
  core.editor.endGesture();
  core.interaction.handle = null;
}

export function click(core: EngineCore, at: Point, opts: { shift?: boolean } = {}) {
  drag(core, at, at, { ...opts, steps: 0 });
}
