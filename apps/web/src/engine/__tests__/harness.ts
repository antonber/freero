// Test harness: a real EngineCore (Yjs store, UI store, registry, editor, select tool) with
// minimal element definitions, plus pointer helpers that route exactly like the canvas does
// (beginGesture → tool handlers → endGesture).
import type { Role } from '@freero/shared';
import type { ElementDefinition, FeatureBundle, Host, Point, ToolPointerEvent } from '../api';
import { unavailableVersionHistory } from '../api';
import { createCore, type EngineCore } from '../runtime/core';
import { dispatchToolPointer } from '../interaction/toolDispatch';

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
    uploadFile: async () => ({ url: '' }),
    renameBoard: async () => undefined,
    saveThumbnail: async () => undefined,
    serverNow: () => Date.now(),
    unfurl: async () => Promise.reject(new Error('No link previews in tests')),
    listTemplates: async () => [],
    loadTemplate: async () => Promise.reject(new Error('No saved templates in tests')),
    saveTemplate: async () => Promise.reject(new Error('No saved templates in tests')),
    deleteTemplate: async () => undefined,
    shareTemplate: async () => Promise.reject(new Error('No teams in tests')),
    versions: unavailableVersionHistory('No version history in tests'),
    importImage: async () => Promise.reject(new Error('No server in tests')),
    fetchImage: async () => Promise.reject(new Error('No server in tests')),
    listMembers: async () => [],
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

function toolEvent(core: EngineCore, world: Point, mods: { shift?: boolean; alt?: boolean; meta?: boolean } = {}, button = 0): ToolPointerEvent {
  const ev = {
    editor: core.editor,
    point: world,
    screen: core.editor.worldToScreen(world),
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    metaKey: !!mods.meta,
    button,
    buttons: 1, // the helpers only model presses and drags
    pressure: 0.5,
    pointerType: 'mouse',
  } as unknown as ToolPointerEvent;
  Object.defineProperty(ev, 'target', { get: () => core.editor.hitTest(world) });
  return ev;
}

/**
 * Drags with a tool (default select) from → to in `steps` moves (world coords), like a real
 * pointer, through the canvas' own dispatch (grid points for creation tools).
 */
export function drag(
  core: EngineCore,
  from: Point,
  to: Point,
  opts: { shift?: boolean; alt?: boolean; meta?: boolean; handle?: string; steps?: number; tool?: string } = {},
) {
  const tool = core.registry.toolsById.get(opts.tool ?? 'select')!;
  core.interaction.handle = opts.handle ?? null;
  core.interaction.clickCount = 1;
  core.editor.beginGesture();
  dispatchToolPointer(core, tool, 'onPointerDown', toolEvent(core, from, opts));
  const steps = opts.steps ?? 5;
  for (let i = 1; i <= steps; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    dispatchToolPointer(core, tool, 'onPointerMove', toolEvent(core, p, opts));
  }
  dispatchToolPointer(core, tool, 'onPointerUp', toolEvent(core, to, opts));
  core.editor.endGesture();
  core.interaction.handle = null;
}

export function click(core: EngineCore, at: Point, opts: { shift?: boolean; alt?: boolean; tool?: string } = {}) {
  drag(core, at, at, { ...opts, steps: 0 });
}
