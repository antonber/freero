// Global keyboard + clipboard routing for a mounted board.
import type { BoardElement } from '@freero/shared';
import type { EngineCore } from '../runtime/core';
import { eventKey, isPrintableKey, matchShortcut, parseShortcut } from '../runtime/shortcuts';
import { NATIVE_CLIPBOARD_COMMANDS } from '../editor/engineCommands';
import { translateElement } from '../editor/clipboard';
import { keyResizePatches } from '../editor/exact';
import { richTextToPlain } from '../text/sanitize';
import { elementAABB, rectContainsRect, rectCenter, rectUnion } from '../geometry/geometry';
import { gridNudge } from '../geometry/snap';
import { readingOrderByFrame } from '../geometry/order';
import { dispatchToolPointer } from './toolDispatch';
import type { Point, Rect, ToolDefinition, ToolPointerEvent } from '../api';
import type { Registered } from '../runtime/registry';

/** A pause this long (ms) after the last arrow-key nudge ends the burst (one undo step). */
const NUDGE_IDLE_MS = 1000;
/** Grid lines a Shift+arrow nudge moves while snap to grid is on. */
const GRID_NUDGE_SHIFT_STEPS = 5;
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

/** Undo/redo shortcuts: they also work from non-modal popovers (see onKeyDown). */
const UNDO_SHORTCUTS = new Set(['mod+z', 'mod+shift+z', 'mod+y']);

/** Shortcuts the rich-text editor keeps for itself while editing. */
const TEXT_RESERVED = new Set(['b', 'i', 'u', 'z', 'y', 'c', 'v', 'x', 'a', 'k', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'backspace', 'delete', 'home', 'end']);

/**
 * Keys `onKeyDown` below handles itself (not through commands or tool shortcuts), for the
 * shortcut reference (`Editor.getShortcuts`). Keep in step with `onKeyDown`: a key handled there
 * and not listed here is a key nobody can discover.
 */
export const ENGINE_KEYS: Array<{ name: string; label: string; shortcuts: string[]; minRole: 'viewer' | 'editor' }> = [
  { name: 'escape', label: 'Deselect, stop editing or cancel', shortcuts: ['escape'], minRole: 'viewer' },
  { name: 'delete', label: 'Delete', shortcuts: ['backspace'], minRole: 'editor' },
  { name: 'nudge', label: 'Nudge selection', shortcuts: ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'], minRole: 'editor' },
  { name: 'nudgeFar', label: 'Nudge selection by 10', shortcuts: ['shift+arrowup', 'shift+arrowdown', 'shift+arrowleft', 'shift+arrowright'], minRole: 'editor' },
  { name: 'cycle', label: 'Select next item', shortcuts: ['tab'], minRole: 'viewer' },
  { name: 'cycleBack', label: 'Select previous item', shortcuts: ['shift+tab'], minRole: 'viewer' },
  { name: 'jump', label: 'Select the nearest item in that direction', shortcuts: ['alt+arrowup', 'alt+arrowdown', 'alt+arrowleft', 'alt+arrowright'], minRole: 'viewer' },
  { name: 'resize', label: 'Resize selection (wider, narrower, taller, shorter)', shortcuts: ['alt+shift+arrowright', 'alt+shift+arrowleft', 'alt+shift+arrowdown', 'alt+shift+arrowup'], minRole: 'editor' },
  { name: 'place', label: 'With a creation tool: place an item next to the selection', shortcuts: ['enter'], minRole: 'editor' },
  { name: 'menu', label: 'Open the menu of the selection', shortcuts: ['shift+f10', 'contextmenu'], minRole: 'viewer' },
  { name: 'format', label: 'Move focus to the format toolbar', shortcuts: ['alt+f10'], minRole: 'editor' },
  { name: 'regions', label: 'Move focus between the canvas and the toolbars', shortcuts: ['f6', 'shift+f6'], minRole: 'viewer' },
  { name: 'pan', label: 'Pan (hold and drag)', shortcuts: ['space'], minRole: 'viewer' },
];

/**
 * Board regions F6 / Shift+F6 move focus between, in this order. Chrome marks its containers
 * `data-fr-region="<name>"` (the canvas is the viewport itself).
 */
export const REGION_ORDER = ['canvas', 'tools', 'board', 'people', 'format', 'dock', 'view'] as const;

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusable controls inside `root`, in DOM order, that are actually shown. */
function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 || el === document.activeElement);
}

export function isTextInput(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'range', 'color', 'submit'].includes(type);
  }
  return false;
}

/** True when the event target is the engine's own rich-text editor. */
const inEngineTextEditor = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest('[data-fr-text-editor]');

/** True when focus is in chrome that should own the keyboard (dialogs, menus with inputs…). */
const inForeignUi = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest('[role="dialog"], [data-fr-keyboard-trap]');

export function installKeyboard(core: EngineCore): () => void {
  const editor = core.editor;
  const ui = core.ui;

  const commandsByShortcut = () =>
    [...core.registry.commands.values()].filter((c) => c.def.shortcut && !NATIVE_CLIPBOARD_COMMANDS.has(c.def.id));

  /** `altGr`: AltGr + a bracket also answers mod+bracket (see MatchOptions); never while typing text. */
  const tryCommands = (e: KeyboardEvent, filter: (shortcut: string) => boolean, { altGr = true } = {}): boolean => {
    for (const { def, feature } of commandsByShortcut()) {
      const bindings = [def.shortcut!, ...(def.extraShortcuts ?? [])];
      if (!bindings.some((sc) => filter(sc) && matchShortcut(e, sc, { altGr }))) continue;
      const scoped = core.scoped(feature);
      if (!editor.can(def.minRole ?? 'editor')) continue;
      if (def.when && !def.when(scoped)) continue;
      e.preventDefault();
      def.run(scoped);
      return true;
    }
    return false;
  };

  const selectedTypesHandle = (e: KeyboardEvent): boolean => {
    const selection = editor
      .getSelection()
      .map((id) => editor.getElement(id))
      .filter((el): el is BoardElement => !!el);
    const asked = new Set<string>();
    for (const el of selection) {
      if (asked.has(el.type)) continue;
      asked.add(el.type);
      const reg = core.registry.elements.get(el.type);
      if (reg?.def.onKeyDown?.(e, { editor: core.scoped(reg.feature), selection })) return true;
    }
    return false;
  };

  // A burst of arrow-key nudges is ONE undo step: the first nudge opens a gesture, which closes
  // after a pause or as soon as anything else happens (another key, a pointer press, blur).
  let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  const endNudgeBurst = () => {
    if (!nudgeTimer) return;
    clearTimeout(nudgeTimer);
    nudgeTimer = null;
    editor.endGesture();
  };

  /**
   * The selection the last Tab cycle made. While it is still the selection, Tab keeps cycling even
   * on items whose type claims Tab (a sticky's "add to the right", a mind-map "add child"): those
   * keep Tab for items the user picked, so Tab-walking never creates notes by surprise.
   */
  let cycled: string[] | null = null;
  const stillCycling = () => {
    const sel = editor.getSelection();
    return !!cycled && sel.length === cycled.length && sel.every((id, i) => id === cycled![i]);
  };
  const isCycleKey = (e: KeyboardEvent, target: EventTarget | null) =>
    eventKey(e) === 'tab' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    // Only from the canvas: focused chrome keeps native Tab focus navigation.
    (target === document.body || target === core.dom.viewport || target === null);

  /** What keyboard walking reaches: every visible item but lines (they're read with their ends). */
  const walkable = () => editor.getVisibleElements().filter((el) => el.type !== 'connector');

  /** Selects `id` (with its group) by keyboard and brings it into view at the same zoom. */
  const selectAndReveal = (id: string) => {
    const ids = editor.expandGroups([id]);
    editor.select(ids);
    cycled = editor.getSelection();
    reveal(ids);
  };

  /** Bring `ids` into view (same zoom) when they aren't fully visible in the free part of the screen. */
  const reveal = (ids: string[]) => {
    const b = editor.getBounds(ids, { visual: true });
    if (!b) return;
    const safe = editor.getSafeArea();
    const tl = editor.screenToWorld({ x: safe.x, y: safe.y });
    const br = editor.screenToWorld({ x: safe.x + safe.w, y: safe.y + safe.h });
    if (rectContainsRect({ x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }, b)) return;
    const cam = editor.getCamera();
    if (b.w * cam.zoom > safe.w * 0.9 || b.h * cam.zoom > safe.h * 0.9) return editor.zoomToFit(ids, { maxZoom: cam.zoom });
    const c = rectCenter(b);
    const sc = { x: safe.x + safe.w / 2, y: safe.y + safe.h / 2 };
    editor.setCamera({ x: c.x - sc.x / cam.zoom, y: c.y - sc.y / cam.zoom, zoom: cam.zoom }, { animate: true });
  };

  /**
   * Alt+arrow: the nearest item in that direction from the selection's center (what lies more
   * along the direction than across it wins), skipping the frame the selection sits in.
   */
  const jump = (e: KeyboardEvent): boolean => {
    const dir = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[eventKey(e)];
    if (!dir || !e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return false;
    const items = walkable();
    if (!items.length) return false;
    e.preventDefault();
    const sel = editor.getSelection();
    const from = sel.length ? editor.getBounds(sel) : null;
    if (!from) {
      selectAndReveal(readingOrderByFrame(items)[0].id);
      return true;
    }
    const c = rectCenter(from);
    const taken = new Set(editor.expandGroups(sel));
    let best: string | null = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (taken.has(el.id)) continue;
      const r = elementAABB(el);
      if (rectContainsRect(r, from)) continue;
      const p = rectCenter(r);
      const along = (p.x - c.x) * dir[0] + (p.y - c.y) * dir[1];
      const across = Math.abs((p.x - c.x) * dir[1] - (p.y - c.y) * dir[0]);
      if (along <= 0) continue;
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = el.id;
      }
    }
    if (best) selectAndReveal(best);
    return true;
  };

  /** Alt+Shift+arrow: resize the selection by one step (see keyResizePatches), in the nudge burst. */
  const keyResize = (e: KeyboardEvent): boolean => {
    const k = eventKey(e);
    const spec = ({ arrowright: ['w', 1], arrowleft: ['w', -1], arrowdown: ['h', 1], arrowup: ['h', -1] } as const)[k as 'arrowright'];
    if (!spec || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return false;
    const sel = editor.getSelection();
    if (!sel.length) return false;
    e.preventDefault();
    if (!editor.guardWrite()) return true;
    const els = sel.map((id) => editor.getElement(id)).filter((el): el is BoardElement => !!el);
    const patches = keyResizePatches(editor, els, spec[0], spec[1]);
    if (!patches.length) return true;
    if (nudgeTimer) clearTimeout(nudgeTimer);
    else editor.beginGesture();
    nudgeTimer = setTimeout(endNudgeBurst, NUDGE_IDLE_MS);
    editor.updateMany(patches);
    return true;
  };

  /** Shift+F10 / the Menu key: the context menu, opened at the selection (or the view's center). */
  const openMenuByKeyboard = () => {
    const vp = core.dom.viewport;
    const origin = vp?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const sel = editor.getSelection();
    const b: Rect | null = sel.length ? editor.getBounds(sel) : null;
    const size = editor.getViewportSize();
    const screen = b
      ? editor.worldToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
      : { x: size.width / 2, y: size.height / 2 };
    const at = { x: Math.max(0, Math.min(size.width, screen.x)), y: Math.max(0, Math.min(size.height, screen.y)) };
    ui.setState({ contextMenu: { x: origin.left + at.x, y: origin.top + at.y, world: editor.screenToWorld(at), keyboard: true } });
  };

  /** F6 / Shift+F6: focus the first control of the next / previous region that is shown. */
  const cycleRegion = (target: EventTarget | null, dir: 1 | -1) => {
    const board = core.dom.viewport?.closest('.fr-board');
    if (!board || !core.dom.viewport) return;
    const regions = new Map<string, HTMLElement>();
    regions.set('canvas', core.dom.viewport);
    for (const el of board.querySelectorAll<HTMLElement>('[data-fr-region]')) regions.set(el.dataset.frRegion!, el);
    const order = REGION_ORDER.filter((r) => regions.has(r) && (r === 'canvas' || focusables(regions.get(r)!).length));
    const current = target instanceof HTMLElement ? REGION_ORDER.find((r) => regions.get(r)?.contains(target)) : undefined;
    const at = current ? order.indexOf(current) : 0;
    const next = order[(at + dir + order.length) % order.length];
    if (next === 'canvas') core.dom.viewport.focus({ preventScroll: true });
    else focusables(regions.get(next)!)[0]?.focus({ preventScroll: true });
  };

  /** Arrow keys inside a chrome toolbar move between its controls (instead of nudging items). */
  const toolbarArrows = (e: KeyboardEvent, target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement) || e.altKey || e.ctrlKey || e.metaKey) return false;
    const bar = target.closest<HTMLElement>('[role="toolbar"]');
    if (!bar || !core.dom.viewport?.closest('.fr-board')?.contains(bar)) return false;
    const vertical = bar.getAttribute('aria-orientation') === 'vertical';
    const k = eventKey(e);
    const step = (vertical ? { arrowup: -1, arrowdown: 1 } : { arrowleft: -1, arrowright: 1 })[k as 'arrowup'];
    const items = focusables(bar);
    if (!items.length) return false;
    let i = items.indexOf(target);
    if (step) i = (i + step + items.length) % items.length;
    else if (k === 'home') i = 0;
    else if (k === 'end') i = items.length - 1;
    else return false;
    e.preventDefault();
    items[i].focus();
    return true;
  };

  /**
   * Enter with a creation tool (sticky, shape, text, comment…): what a click would make, placed
   * on a free spot right of the selection (or in the middle of the view) — creation without a mouse.
   */
  const placeWithTool = (tool: Registered<ToolDefinition>) => {
    const size = { w: 200, h: 200 };
    const sel = editor.getSelection();
    const b = sel.length ? editor.getBounds(sel) : null;
    const near: Point | undefined = b ? { x: b.x + b.w + 40 + size.w / 2, y: b.y + b.h / 2 } : undefined;
    const spot = editor.findFreeSpot(size, { near, gap: 24 });
    const point = { x: spot.x + size.w / 2, y: spot.y + size.h / 2 };
    const ev = (kind: 'down' | 'up'): ToolPointerEvent => {
      const e = {
        editor: core.scoped(tool.feature),
        point: { ...point },
        screen: editor.worldToScreen(point),
        shiftKey: false,
        altKey: false,
        metaKey: false,
        button: 0,
        buttons: kind === 'down' ? 1 : 0,
        pressure: 0.5,
        pointerType: 'mouse',
      } as unknown as ToolPointerEvent;
      Object.defineProperty(e, 'target', { enumerable: true, get: () => editor.hitTest(point) });
      return e;
    };
    core.interaction.handle = null;
    core.interaction.clickCount = 1;
    editor.beginGesture();
    try {
      dispatchToolPointer(core, tool, 'onPointerDown', ev('down'));
      dispatchToolPointer(core, tool, 'onPointerUp', ev('up'));
    } finally {
      editor.endGesture();
    }
    const placed = editor.getSelection();
    if (placed.length) reveal(placed);
  };

  /** Tab / Shift+Tab with nothing being edited: select the next/previous item in reading order. */
  const cycleSelection = (dir: 1 | -1) => {
    const items = readingOrderByFrame(walkable());
    if (!items.length) return;
    const sel = editor.getSelection();
    const selSet = new Set(sel);
    const groups = new Set(sel.map((id) => editor.getElement(id)?.groupId).filter(Boolean));
    const at = dir > 0 ? items.map((el) => selSet.has(el.id)).lastIndexOf(true) : items.findIndex((el) => selSet.has(el.id));
    let next = items[0];
    if (at < 0 && dir < 0) next = items[items.length - 1];
    if (at >= 0) {
      for (let step = 1; step <= items.length; step++) {
        const cand = items[(at + dir * step + items.length * step) % items.length];
        if (!selSet.has(cand.id) && !(cand.groupId && groups.has(cand.groupId))) {
          next = cand;
          break;
        }
      }
    }
    // Keyboard focus belongs on the canvas while walking it (a visible focus ring, screen readers
    // in the canvas' application mode), not on the page body.
    if (document.activeElement === document.body) core.dom.viewport?.focus({ preventScroll: true });
    selectAndReveal(next.id);
  };

  const nudge = (e: KeyboardEvent): boolean => {
    const k = eventKey(e);
    const dir = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
    if (!dir || e.ctrlKey || e.metaKey || e.altKey) return false;
    const sel = editor.getSelection();
    if (!sel.length) return false;
    e.preventDefault();
    if (!editor.guardWrite()) return true;
    const els = editor
      .withChildren(sel)
      .map((id) => editor.getElement(id))
      .filter((el): el is BoardElement => !!el && !el.locked);
    if (!els.length) return true;
    // Snap to grid on: one grid line per press (Shift: GRID_NUDGE_SHIFT_STEPS), ending on the grid
    // like a snapped drag. Off: 1 px (Shift: 10 px).
    const settings = core.store.getSettings();
    let dx = dir[0] * (e.shiftKey ? 10 : 1);
    let dy = dir[1] * (e.shiftKey ? 10 : 1);
    if (settings.snapToGrid) {
      const b = rectUnion(els.map(elementAABB))!;
      const steps = e.shiftKey ? GRID_NUDGE_SHIFT_STEPS : 1;
      dx = dir[0] ? gridNudge(b.x, dir[0] as -1 | 1, settings.gridSize, steps) : 0;
      dy = dir[1] ? gridNudge(b.y, dir[1] as -1 | 1, settings.gridSize, steps) : 0;
    }
    if (nudgeTimer) clearTimeout(nudgeTimer);
    else editor.beginGesture();
    nudgeTimer = setTimeout(endNudgeBurst, NUDGE_IDLE_MS);
    editor.updateMany(
      els.map((el) => {
        const t = translateElement(el, dx, dy);
        const { id: _id, type: _type, ...patch } = t;
        return { id: el.id, patch };
      }),
    );
    return true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (nudgeTimer && !MODIFIER_KEYS.has(e.key) && !eventKey(e).startsWith('arrow')) endNudgeBurst();
    if (e.defaultPrevented || e.isComposing) return;
    const target = e.target;
    const key = eventKey(e);
    const inModal = target instanceof HTMLElement && !!target.closest('[aria-modal="true"]');

    // ---- moving focus between the canvas and the chrome (from anywhere but a modal dialog)
    if (key === 'f6' && !e.ctrlKey && !e.metaKey && !e.altKey && !inModal) {
      e.preventDefault();
      if (editor.getEditingId()) editor.stopEditing();
      cycleRegion(target, e.shiftKey ? -1 : 1);
      return;
    }
    if (key === 'f10' && e.altKey && !e.ctrlKey && !e.metaKey && !inModal) {
      e.preventDefault();
      const bar = core.dom.viewport?.closest('.fr-board')?.querySelector('[data-fr-format-toolbar]');
      if (bar) focusables(bar)[0]?.focus({ preventScroll: true });
      return;
    }

    // ---- while editing text in the shared editor
    if (inEngineTextEditor(target)) {
      if (e.key === 'Escape') {
        e.preventDefault();
        editor.stopEditing();
        return;
      }
      // Feature commands that make sense mid-edit (e.g. Tab → next sticky).
      tryCommands(
        e,
        (sc) => {
          const p = parseShortcut(sc);
          if (p.key === 'tab') return true;
          return (p.mod || p.alt) && !TEXT_RESERVED.has(p.key);
        },
        { altGr: false },
      );
      return;
    }
    if (isTextInput(target)) return;
    // Focus in a chrome region (a toolbar button): arrows move along the toolbar, Escape goes back
    // to the canvas. Other keys keep working as on the canvas (shortcuts, Delete).
    const inRegion = target instanceof HTMLElement && !!target.closest('[data-fr-region]');
    if (inRegion && toolbarArrows(e, target)) return;
    if (inRegion && e.key === 'Escape' && !inForeignUi(target)) {
      e.preventDefault();
      core.dom.viewport?.focus({ preventScroll: true });
      return;
    }
    if (inForeignUi(target)) {
      // A non-modal popover (a color picker just used) keeps undo/redo: Ctrl+Z right after
      // picking a color must undo it, not do nothing until the popover is dismissed.
      const modal = target instanceof HTMLElement && !!target.closest('[aria-modal="true"]');
      if (!modal) tryCommands(e, (sc) => UNDO_SHORTCUTS.has(sc));
      return;
    }

    // Editing just started (e.g. Tab → next sticky) but focus hasn't reached the editor yet:
    // route typed characters into it instead of losing them.
    const editingId = editor.getEditingId();
    if (editingId && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (core.text?.id === editingId) core.text.insertText(e.key);
      else {
        const req = ui.getState().editRequest;
        if (req) ui.setState({ editRequest: { ...req, initialText: (req.initialText ?? '') + e.key } });
      }
      return;
    }

    // [additive] A tap of Space first goes to the selected types (mind map: collapse/expand);
    // when none claims it, holding Space pans as usual.
    if (e.key === ' ' && !e.repeat && selectedTypesHandle(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === ' ' && !e.repeat) {
      ui.setState({ spaceHeld: true });
      e.preventDefault();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      return;
    }

    const toolReg = core.registry.toolsById.get(ui.getState().toolId);
    if (toolReg?.def.onKeyDown?.(core.scoped(toolReg.feature), e)) {
      e.preventDefault();
      return;
    }

    if ((key === 'f10' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) || key === 'contextmenu') {
      e.preventDefault();
      openMenuByKeyboard();
      return;
    }

    if (
      key === 'enter' &&
      !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
      toolReg &&
      toolReg.def.id !== 'select' &&
      toolReg.def.id !== 'hand' &&
      toolReg.def.onPointerDown &&
      editor.can(toolReg.def.minRole ?? 'editor')
    ) {
      e.preventDefault();
      placeWithTool(toolReg);
      return;
    }

    // Tab-walking continues past items whose type claims Tab (see `cycled`).
    if (isCycleKey(e, target) && stillCycling()) {
      e.preventDefault();
      cycleSelection(e.shiftKey ? -1 : 1);
      return;
    }

    // Element types in the selection get the key before the engine's own keys and shortcuts
    // (Enter / Delete / Tab on a mind-map node mean something else than on a sticky).
    if (e.key !== 'Escape' && selectedTypesHandle(e)) {
      e.preventDefault();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (editingId) return editor.stopEditing();
      const s = ui.getState();
      if (s.contextMenu) return ui.setState({ contextMenu: null });
      if (core.interaction.cancel) return core.interaction.cancel();
      if (s.following) return editor.follow(null);
      if (s.toolId !== 'select') return editor.setTool('select');
      // Walk out one level: a member picked out of a group (double-click) → the whole group → nothing.
      const whole = editor.expandGroups(s.selection);
      if (whole.length > s.selection.length) return editor.select(whole);
      if (s.selection.length) return editor.clearSelection();
      return;
    }

    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      editor.runCommand('engine.delete');
      return;
    }

    if (keyResize(e) || jump(e) || nudge(e)) return;

    // Typing on a single selected EMPTY text element (a fresh "+" copy, a new sticky) fills it.
    // Items that already have text keep letters as tool shortcuts (N, T, S… right after Esc must
    // switch tools, not append a stray letter to the note); Enter or double-click edits them.
    // Before the Shift shortcuts: '?', '!' or ')' typed into a fresh note are text like any other
    // character, not "open the shortcut sheet" / "zoom to fit".
    if (isPrintableKey(e)) {
      const sel = editor.getSelection();
      if (sel.length === 1 && editor.can('editor')) {
        const el = editor.getElement(sel[0]);
        const field = el && editor.getDefinition(el.type)?.textField;
        const empty = !!field && !richTextToPlain(String((el as unknown as Record<string, unknown>)[field] ?? '')).trim();
        if (el && !el.locked && empty) {
          e.preventDefault();
          editor.startEditing(el.id, { initialText: e.key });
          return;
        }
      }
    }

    // Modifier combos and named keys first.
    if (tryCommands(e, (sc) => {
      const p = parseShortcut(sc);
      return p.mod || p.alt || p.key.length > 1 || p.shift;
    })) return;

    // Tab / Shift+Tab that no command claimed (sticky "add to the right" on a sticky you picked,
    // mind-map "add child") cycles through the board's items.
    if (isCycleKey(e, target)) {
      e.preventDefault();
      cycleSelection(e.shiftKey ? -1 : 1);
      return;
    }

    // Single-key commands, then tool shortcuts.
    if (tryCommands(e, () => true)) return;
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const key = eventKey(e);
      for (const { def } of core.registry.tools) {
        if (def.shortcut && def.shortcut.toLowerCase() === key && editor.can(def.minRole ?? 'editor')) {
          e.preventDefault();
          editor.setTool(def.id);
          return;
        }
      }
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') ui.setState({ spaceHeld: false });
  };

  const onBlur = () => {
    endNudgeBurst();
    ui.setState({ spaceHeld: false });
  };
  // Pressing anything (a tool on the canvas, a toolbar button) ends a nudge burst first, so its
  // own undo step never merges into the nudges.
  const onPointerDown = () => endNudgeBurst();

  // ---- clipboard: the native events carry system clipboard data synchronously.
  const onCopy = (e: ClipboardEvent) => {
    const forced = core.clipboard.copyIds;
    if (!forced && (isTextInput(e.target) || isTextInput(document.activeElement))) return;
    const ids = forced ?? editor.getSelection();
    if (!ids.length) return;
    const data = editor.buildClipboard(ids);
    if (!data || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/html', data.html);
    e.clipboardData.setData('text/plain', data.text || ' ');
    core.clipboard.memory = { payload: data.payload, text: data.text || ' ' };
  };

  const onCut = (e: ClipboardEvent) => {
    if (isTextInput(e.target) || isTextInput(document.activeElement)) return;
    const ids = editor.getSelection();
    if (!ids.length) return;
    if (!editor.guardWrite()) return;
    onCopy(e);
    editor.remove(ids.filter((id) => !editor.getElement(id)?.locked));
  };

  const onPaste = (e: ClipboardEvent) => {
    if (isTextInput(e.target) || isTextInput(document.activeElement)) return;
    if (inForeignUi(e.target)) return;
    const cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    void editor.importData(
      { files: Array.from(cd.files), text: cd.getData('text/plain') || null, html: cd.getData('text/html') || null },
      editor.pastePoint(),
    );
  };

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  document.addEventListener('paste', onPaste);
  return () => {
    endNudgeBurst();
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown);

    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCut);
    document.removeEventListener('paste', onPaste);
  };
}
