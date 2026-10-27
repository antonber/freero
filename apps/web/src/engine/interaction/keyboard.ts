// Global keyboard + clipboard routing for a mounted board.
import type { BoardElement } from '@freero/shared';
import type { EngineCore } from '../runtime/core';
import { eventKey, isPrintableKey, matchShortcut, parseShortcut } from '../runtime/shortcuts';
import { NATIVE_CLIPBOARD_COMMANDS } from '../editor/engineCommands';
import { translateElement } from '../editor/clipboard';

/** Shortcuts the rich-text editor keeps for itself while editing. */
const TEXT_RESERVED = new Set(['b', 'i', 'u', 'z', 'y', 'c', 'v', 'x', 'a', 'k', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'backspace', 'delete', 'home', 'end']);

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
    if (isTextInput(target) || inForeignUi(target)) return;

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
      if (s.selection.length) return editor.clearSelection();
      return;
    }

    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      editor.runCommand('engine.delete');
      return;
    }

    if (nudge(e)) return;

    // Modifier combos and named keys first.
    if (tryCommands(e, (sc) => {
      const p = parseShortcut(sc);
      return p.mod || p.alt || p.key.length > 1 || p.shift;
    })) return;

    // Typing on a single selected text element starts editing with that character.
    if (isPrintableKey(e)) {
      const sel = editor.getSelection();
      if (sel.length === 1 && editor.can('editor')) {
        const el = editor.getElement(sel[0]);
        if (el && !el.locked && editor.getDefinition(el.type)?.textField) {
          e.preventDefault();
          editor.startEditing(el.id, { initialText: e.key });
          return;
        }
      }
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

  const onBlur = () => ui.setState({ spaceHeld: false });

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

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  document.addEventListener('paste', onPaste);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCut);
    document.removeEventListener('paste', onPaste);
  };
}
