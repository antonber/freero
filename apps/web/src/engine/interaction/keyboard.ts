// Global keyboard + clipboard routing for a mounted board.
import type { BoardElement } from '@freero/shared';
import type { EngineCore } from '../runtime/core';
import { eventKey, isPrintableKey, matchShortcut, parseShortcut } from '../runtime/shortcuts';
import { NATIVE_CLIPBOARD_COMMANDS } from '../editor/engineCommands';
import { translateElement } from '../editor/clipboard';
import { richTextToPlain } from '../text/sanitize';
import { rectContainsRect, rectCenter } from '../geometry/geometry';
import { readingOrder } from '../geometry/order';

/** A pause this long (ms) after the last arrow-key nudge ends the burst (one undo step). */
const NUDGE_IDLE_MS = 1000;
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
  { name: 'pan', label: 'Pan (hold and drag)', shortcuts: ['space'], minRole: 'viewer' },
];

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

  const tryCommands = (e: KeyboardEvent, filter: (shortcut: string) => boolean): boolean => {
    for (const { def, feature } of commandsByShortcut()) {
      const sc = def.shortcut!;
      if (!filter(sc) || !matchShortcut(e, sc)) continue;
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

  /** Tab / Shift+Tab with nothing being edited: select the next/previous item in reading order. */
  const cycleSelection = (dir: 1 | -1) => {
    const items = readingOrder(editor.getVisibleElements().filter((el) => el.type !== 'connector'));
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
    const ids = editor.expandGroups([next.id]);
    editor.select(ids);
    cycled = editor.getSelection();
    // Bring it into view (same zoom) when it isn't fully visible in the free part of the screen.
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

  const nudge = (e: KeyboardEvent): boolean => {
    const k = eventKey(e);
    const dir = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
    if (!dir || e.ctrlKey || e.metaKey || e.altKey) return false;
    const sel = editor.getSelection();
    if (!sel.length) return false;
    e.preventDefault();
    if (!editor.guardWrite()) return true;
    const step = e.shiftKey ? 10 : 1;
    const els = editor
      .withChildren(sel)
      .map((id) => editor.getElement(id))
      .filter((el): el is BoardElement => !!el && !el.locked);
    if (!els.length) return true;
    if (nudgeTimer) clearTimeout(nudgeTimer);
    else editor.beginGesture();
    nudgeTimer = setTimeout(endNudgeBurst, NUDGE_IDLE_MS);
    editor.updateMany(
      els.map((el) => {
        const t = translateElement(el, dir[0] * step, dir[1] * step);
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

    // ---- while editing text in the shared editor
    if (inEngineTextEditor(target)) {
      if (e.key === 'Escape') {
        e.preventDefault();
        editor.stopEditing();
        return;
      }
      // Feature commands that make sense mid-edit (e.g. Tab → next sticky).
      tryCommands(e, (sc) => {
        const p = parseShortcut(sc);
        if (p.key === 'tab') return true;
        return (p.mod || p.alt) && !TEXT_RESERVED.has(p.key);
      });
      return;
    }
    if (isTextInput(target)) return;
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

    if (nudge(e)) return;

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
