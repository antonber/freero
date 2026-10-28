// Engine-owned commands. They go through the same registry as feature commands, so menus and
// shortcuts treat them uniformly (and features can call editor.runCommand('engine.<verb>')).
import {
  ArrowDown,
  ArrowUp,
  BringToFront,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Group,
  Grid3x3,
  Link2,
  Lock,
  Magnet,
  Maximize,
  MousePointerSquareDashed,
  PaintBucket,
  Scissors,
  SendToBack,
  Trash2,
  Ungroup,
} from 'lucide-react';
import type { CommandDefinition, Editor } from '../api';
import type { EngineCore } from '../runtime/core';
import { nextZoomStep } from '../camera/camera';
import { BACKGROUNDS, GRID_SIZES, GRID_STYLES } from './boardSettings';

/** Commands whose shortcut is display-only: the keyboard path is the native copy/cut/paste event. */
export const NATIVE_CLIPBOARD_COMMANDS = new Set(['engine.copy', 'engine.cut', 'engine.paste']);

export function elementLink(boardPath: string, id: string): string {
  const url = new URL(boardPath, window.location.origin);
  url.search = '';
  url.searchParams.set('item', id);
  return url.toString();
}

export function createEngineCommands(core: EngineCore): CommandDefinition[] {
  const sel = (e: Editor) => e.getSelection();
  const hasSel = (e: Editor) => sel(e).length > 0;
  /** Why selection commands are greyed out in the command palette. */
  const NEEDS_SEL = 'Select something first';
  const selected = (e: Editor) => sel(e).map((id) => e.getElement(id)!).filter(Boolean);
  /** Zoom commands are the user's own camera moves (shortcuts, zoom controls): see Editor 'camera-user'. */
  const user = (fn: () => void) => core.editor.asUser(fn);
  return [
    { id: 'engine.undo', label: 'Undo', shortcut: 'mod+z', run: (e) => e.undo() },
    { id: 'engine.redo', label: 'Redo', shortcut: 'mod+shift+z', run: (e) => e.redo() },
    { id: 'engine.redoAlt', label: 'Redo', shortcut: 'mod+y', run: (e) => e.redo() },
    { id: 'engine.cut', icon: Scissors, label: 'Cut', shortcut: 'mod+x', menus: ['context'], when: hasSel, disabledReason: NEEDS_SEL, run: (e) => e.cut() },
    { id: 'engine.copy', icon: Copy, label: 'Copy', shortcut: 'mod+c', minRole: 'viewer', menus: ['context'], when: hasSel, disabledReason: NEEDS_SEL, run: (e) => e.copy() },
    {
      id: 'engine.paste',
      icon: ClipboardPaste,
      label: 'Paste',
      shortcut: 'mod+v',
      menus: ['context'],
      run: (e) => {
        const m = core.ui.getState().contextMenu;
        e.paste(m ? m.world : undefined);
      },
    },
    { id: 'engine.duplicate', icon: CopyPlus, label: 'Duplicate', shortcut: 'mod+d', menus: ['context'], when: hasSel, disabledReason: NEEDS_SEL, run: (e) => e.duplicate(sel(e)) },
    {
      id: 'engine.delete',
      icon: Trash2,
      label: 'Delete',
      shortcut: 'delete',
      menus: ['context'],
      when: hasSel,
      disabledReason: NEEDS_SEL,
      run: (e) => e.remove(selected(e).filter((el) => !el.locked).map((el) => el.id)),
    },
    {
      id: 'engine.selectAll',
      icon: MousePointerSquareDashed,
      label: 'Select all',
      shortcut: 'mod+a',
      minRole: 'viewer',
      run: (e) => e.select(e.getElements().map((el) => el.id)),
    },
    {
      id: 'engine.group',
      icon: Group,
      label: 'Group',
      shortcut: 'mod+g',
      menus: ['context'],
      when: (e) => {
        const els = selected(e);
        return els.length > 1 && !(els[0].groupId && els.every((el) => el.groupId === els[0].groupId));
      },
      disabledReason: 'Select two or more items that aren’t one group',
      run: (e) => e.group(sel(e)),
    },
    {
      id: 'engine.ungroup',
      icon: Ungroup,
      label: 'Ungroup',
      shortcut: 'mod+shift+g',
      menus: ['context'],
      when: (e) => selected(e).some((el) => el.groupId),
      disabledReason: 'Select a group',
      run: (e) => e.ungroup(sel(e)),
    },
    // Brackets need AltGr on many layouts (handled in matchShortcut); the arrows work on every one.
    // Mod+Shift+] / [ is the tab switch of Chrome and Safari on macOS, which can take it before the
    // board does: Mod+Alt+↑ / ↓ step forward / backward on every platform and layout (KAI-175).
    { id: 'engine.bringToFront', icon: BringToFront, label: 'Bring to front', shortcut: 'mod+]', extraShortcuts: ['mod+shift+arrowup'], menus: ['context'], when: hasSel, disabledReason: NEEDS_SEL, run: (e) => e.bringToFront(sel(e)) },
    {
      id: 'engine.bringForward',
      icon: ArrowUp,
      label: 'Bring forward',
      shortcut: 'mod+shift+]',
      extraShortcuts: ['mod+alt+arrowup'],
      menus: ['context'],
      when: hasSel,
      disabledReason: NEEDS_SEL,
      run: (e) => e.bringForward(sel(e)),
    },
    {
      id: 'engine.sendBackward',
      icon: ArrowDown,
      label: 'Send backward',
      shortcut: 'mod+shift+[',
      extraShortcuts: ['mod+alt+arrowdown'],
      menus: ['context'],
      when: hasSel,
      disabledReason: NEEDS_SEL,
      run: (e) => e.sendBackward(sel(e)),
    },
    { id: 'engine.sendToBack', icon: SendToBack, label: 'Send to back', shortcut: 'mod+[', extraShortcuts: ['mod+shift+arrowdown'], menus: ['context'], when: hasSel, disabledReason: NEEDS_SEL, run: (e) => e.sendToBack(sel(e)) },
    {
      id: 'engine.lock',
      icon: Lock,
      label: 'Lock / unlock',
      shortcut: 'mod+shift+l',
      menus: ['context'],
      when: hasSel,
      disabledReason: NEEDS_SEL,
      run: (e) => {
        const els = selected(e);
        const lock = !els.every((el) => el.locked);
        e.updateMany(els.map((el) => ({ id: el.id, patch: { locked: lock } })));
      },
    },
    {
      id: 'engine.copyLink',
      icon: Link2,
      label: 'Copy link to item',
      minRole: 'viewer',
      menus: ['context'],
      when: (e) => sel(e).length === 1,
      disabledReason: 'Select one item',
      run: (e) => {
        const link = elementLink(window.location.pathname, sel(e)[0]);
        navigator.clipboard
          ?.writeText(link)
          .then(() => e.host.notify('Link copied to clipboard', 'success'))
          .catch(() => e.host.notify(link, 'info'));
      },
    },
    { id: 'engine.zoomToFit', icon: Maximize, label: 'Zoom to fit', shortcut: 'shift+1', minRole: 'viewer', run: () => user(() => core.editor.zoomToFit()) },
    {
      id: 'engine.zoomToSelection',
      label: 'Zoom to selection',
      shortcut: 'shift+2',
      minRole: 'viewer',
      when: hasSel,
      disabledReason: NEEDS_SEL,
      run: (e) => user(() => e.zoomToFit(sel(e), { maxZoom: 2 })),
    },
    { id: 'engine.zoom100', label: 'Zoom to 100%', shortcut: 'shift+0', minRole: 'viewer', run: (e) => user(() => e.zoomTo(1)) },
    { id: 'engine.zoomIn', label: 'Zoom in', shortcut: 'mod+=', minRole: 'viewer', run: (e) => user(() => e.zoomTo(nextZoomStep(core.editor.cameraTarget().zoom, 1))) },
    { id: 'engine.zoomOut', label: 'Zoom out', shortcut: 'mod+-', minRole: 'viewer', run: (e) => user(() => e.zoomTo(nextZoomStep(core.editor.cameraTarget().zoom, -1))) },
    {
      id: 'engine.editText',
      label: 'Edit text',
      shortcut: 'enter',
      when: (e) => {
        const els = selected(e);
        return els.length === 1 && !!e.getDefinition(els[0].type)?.textField && !els[0].locked;
      },
      disabledReason: 'Select one unlocked item with text',
      run: (e) => e.startEditing(sel(e)[0], { selectAll: true }),
    },
    ...settingsCommands(),
  ];
}

/**
 * The board menu's settings as commands, so the command palette reaches them (`palette: true`:
 * they have no shortcut or menu entry of their own; the board menu keeps its own controls).
 */
function settingsCommands(): CommandDefinition[] {
  const current = 'Already the current setting';
  return [
    {
      id: 'engine.settings.snapToGrid',
      icon: Magnet,
      label: 'Snap to grid',
      palette: true,
      detail: (e) => (e.getSettings().snapToGrid ? 'on' : 'off'),
      run: (e) => e.updateSettings({ snapToGrid: !e.getSettings().snapToGrid }),
    },
    ...GRID_STYLES.map(
      (g): CommandDefinition => ({
        id: `engine.settings.grid.${g.value}`,
        icon: Grid3x3,
        label: g.value === 'none' ? 'Hide the grid' : `Grid: ${g.label.toLowerCase()}`,
        palette: true,
        when: (e) => e.getSettings().grid !== g.value,
        disabledReason: current,
        run: (e) => e.updateSettings({ grid: g.value }),
      }),
    ),
    ...GRID_SIZES.map(
      (n): CommandDefinition => ({
        id: `engine.settings.gridSize.${n}`,
        icon: Grid3x3,
        label: `Grid size: ${n}`,
        palette: true,
        when: (e) => e.getSettings().gridSize !== n,
        disabledReason: current,
        run: (e) => e.updateSettings({ gridSize: n }),
      }),
    ),
    ...BACKGROUNDS.map(
      (b): CommandDefinition => ({
        id: `engine.settings.background.${b.name.toLowerCase()}`,
        icon: PaintBucket,
        label: `Background: ${b.name}`,
        palette: true,
        when: (e) => e.getSettings().background.toLowerCase() !== b.color.toLowerCase(),
        disabledReason: current,
        run: (e) => e.updateSettings({ background: b.color }),
      }),
    ),
  ];
}
