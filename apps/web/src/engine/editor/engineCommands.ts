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
  ShieldCheck,
  Spline,
  Trash2,
  Ungroup,
} from 'lucide-react';
import { isProtectedLock } from '@freero/shared';
import type { CommandDefinition, Editor } from '../api';
import type { EngineCore } from '../runtime/core';
import { nextZoomStep } from '../camera/camera';
import { BACKGROUNDS, GRID_SIZES, GRID_STYLES } from './boardSettings';

import { t } from '../messages';
const PROTECTED_NOTE = t('onlyTheBoardSOwner');

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
  const NEEDS_SEL = t('selectSomethingFirst');
  const selected = (e: Editor) => sel(e).map((id) => e.getElement(id)!).filter(Boolean);
  /** Zoom commands are the user's own camera moves (shortcuts, zoom controls): see Editor 'camera-user'. */
  const user = (fn: () => void) => core.editor.asUser(fn);
  return [
    { id: 'engine.undo', label: t('undo'), shortcut: 'mod+z', run: (e) => e.undo() },
    { id: 'engine.redo', label: t('redo'), shortcut: 'mod+shift+z', run: (e) => e.redo() },
    { id: 'engine.redoAlt', label: t('redo'), shortcut: 'mod+y', run: (e) => e.redo() },
    { id: 'engine.cut', icon: Scissors, label: t('cut'), shortcut: 'mod+x', menus: ['context'], when: hasSel, disabledReason: NEEDS_SEL, run: (e) => e.cut() },
    {
      id: 'engine.copy',
      icon: Copy,
      label: t('copy'),
      shortcut: 'mod+c',
      minRole: 'viewer',
      menus: ['context'],
      // #123: off for viewers and commenters of a board whose owner turned copying off.
      when: (e) => hasSel(e) && e.host.board.canCopy !== false,
      disabledReason: (e) => (e.host.board.canCopy === false ? t('theBoardSOwnerTurned') : NEEDS_SEL),
      run: (e) => e.copy(),
    },
    {
      id: 'engine.paste',
      icon: ClipboardPaste,
      label: t('paste'),
      shortcut: 'mod+v',
      menus: ['context'],
      run: (e) => {
        const m = core.ui.getState().contextMenu;
        e.paste(m ? m.world : undefined);
      },
    },
    { id: 'engine.duplicate', icon: CopyPlus, label: t('duplicate'), shortcut: 'mod+d', menus: ['context'], when: hasSel, disabledReason: NEEDS_SEL, run: (e) => e.duplicate(sel(e)) },
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
      label: t('selectAll'),
      shortcut: 'mod+a',
      minRole: 'viewer',
      run: (e) => e.select(e.getElements().map((el) => el.id)),
    },
    {
      id: 'engine.group',
      icon: Group,
      label: t('group'),
      shortcut: 'mod+g',
      menus: ['context'],
      when: (e) => {
        const els = selected(e);
        return els.length > 1 && !(els[0].groupId && els.every((el) => el.groupId === els[0].groupId));
      },
      disabledReason: t('selectTwoOrMoreItems'),
      run: (e) => e.group(sel(e)),
    },
    {
      id: 'engine.ungroup',
      icon: Ungroup,
      label: t('ungroup'),
      shortcut: 'mod+shift+g',
      menus: ['context'],
      when: (e) => selected(e).some((el) => el.groupId),
      disabledReason: t('selectAGroup'),
      run: (e) => e.ungroup(sel(e)),
    },
    // Brackets need AltGr on many layouts (handled in matchShortcut); the arrows work on every one.
    // Mod+Shift+] / [ is the tab switch of Chrome and Safari on macOS, which can take it before the
    // board does: Mod+Alt+↑ / ↓ step forward / backward on every platform and layout (KAI-175).
    { id: 'engine.bringToFront', icon: BringToFront, label: t('bringToFront'), shortcut: 'mod+]', extraShortcuts: ['mod+shift+arrowup', 'pageup'], menus: ['context'], when: hasSel, disabledReason: NEEDS_SEL, run: (e) => e.bringToFront(sel(e)) },
    {
      id: 'engine.bringForward',
      icon: ArrowUp,
      label: t('bringForward'),
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
      label: t('sendBackward'),
      shortcut: 'mod+shift+[',
      extraShortcuts: ['mod+alt+arrowdown'],
      menus: ['context'],
      when: hasSel,
      disabledReason: NEEDS_SEL,
      run: (e) => e.sendBackward(sel(e)),
    },
    { id: 'engine.sendToBack', icon: SendToBack, label: t('sendToBack'), shortcut: 'mod+[', extraShortcuts: ['mod+shift+arrowdown', 'pagedown'], menus: ['context'], when: hasSel, disabledReason: NEEDS_SEL, run: (e) => e.sendToBack(sel(e)) },
    {
      id: 'engine.lock',
      icon: Lock,
      label: t('lockUnlock'),
      shortcut: 'mod+shift+l',
      menus: ['context'],
      when: hasSel,
      disabledReason: NEEDS_SEL,
      run: (e) => {
        const els = selected(e);
        const lock = !els.every((el) => el.locked);
        // A protected lock is lifted only by the owner (the server enforces it).
        const held = !lock && !e.mayProtect() ? els.filter(isProtectedLock) : [];
        if (held.length) e.host.notify(held.length === els.length ? PROTECTED_NOTE : t('protectedNoteTheOthersAre', { protected_note: PROTECTED_NOTE }), 'info');
        const open = els.filter((el) => !held.includes(el));
        if (open.length) e.updateMany(open.map((el) => ({ id: el.id, patch: lock ? { locked: true } : { locked: false, lockProtected: false } })));
      },
    },
    {
      // Like a lock, but only the board owner can lift it: a template's frame, a workshop agenda. Mod+Alt+Shift+L — Mod+Shift+P, used for this
      // elsewhere, opens a private window in Firefox and can't be taken there.
      id: 'engine.protectLock',
      icon: ShieldCheck,
      label: t('lockForTheOwnerOnly'),
      shortcut: 'mod+alt+shift+l',
      menus: ['context'],
      detail: (e) => (selected(e).length && selected(e).every(isProtectedLock) ? 'on' : undefined),
      when: (e) => hasSel(e) && e.mayProtect(),
      disabledReason: t('onlyTheBoardSOwner2'),
      run: (e) => {
        const els = selected(e);
        const protect = !els.every(isProtectedLock);
        // Taking protection off leaves an ordinary lock.
        e.updateMany(els.map((el) => ({ id: el.id, patch: protect ? { locked: true, lockProtected: true } : { lockProtected: false } })));
      },
    },
    {
      id: 'engine.copyLink',
      icon: Link2,
      label: t('copyLinkToItem'),
      minRole: 'viewer',
      menus: ['context'],
      when: (e) => sel(e).length === 1,
      disabledReason: t('selectOneItem'),
      run: (e) => {
        const link = elementLink(window.location.pathname, sel(e)[0]);
        navigator.clipboard
          ?.writeText(link)
          .then(() => e.host.notify(t('linkCopiedToClipboard'), 'success'))
          .catch(() => e.host.notify(link, 'info'));
      },
    },
    // Alt+1 / Alt+2 / Mod+0: the keys people bring from other whiteboards, beside Freero's own.
    { id: 'engine.zoomToFit', icon: Maximize, label: t('zoomToFit'), shortcut: 'shift+1', extraShortcuts: ['alt+1'], minRole: 'viewer', run: () => user(() => core.editor.zoomToFit()) },
    {
      id: 'engine.zoomToSelection',
      label: t('zoomToSelection'),
      shortcut: 'shift+2',
      extraShortcuts: ['alt+2'],
      minRole: 'viewer',
      when: hasSel,
      disabledReason: NEEDS_SEL,
      run: (e) => user(() => e.zoomToFit(sel(e), { maxZoom: 2 })),
    },
    { id: 'engine.zoom100', label: t('zoomTo100'), shortcut: 'shift+0', extraShortcuts: ['mod+0'], minRole: 'viewer', run: (e) => user(() => e.zoomTo(1)) },
    { id: 'engine.zoomIn', label: t('zoomIn'), shortcut: 'mod+=', minRole: 'viewer', run: (e) => user(() => e.zoomTo(nextZoomStep(core.editor.cameraTarget().zoom, 1))) },
    { id: 'engine.zoomOut', label: t('zoomOut'), shortcut: 'mod+-', minRole: 'viewer', run: (e) => user(() => e.zoomTo(nextZoomStep(core.editor.cameraTarget().zoom, -1))) },
    {
      id: 'engine.editText',
      label: t('editText'),
      shortcut: 'enter',
      when: (e) => {
        const els = selected(e);
        return els.length === 1 && !!e.getDefinition(els[0].type)?.textField && !els[0].locked;
      },
      disabledReason: t('selectOneUnlockedItemWith'),
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
  const current = t('alreadyTheCurrentSetting');
  return [
    {
      id: 'engine.settings.snapToGrid',
      icon: Magnet,
      label: t('snapToGrid'),
      palette: true,
      detail: (e) => (e.getSettings().snapToGrid ? 'on' : 'off'),
      run: (e) => e.updateSettings({ snapToGrid: !e.getSettings().snapToGrid }),
    },
    {
      id: 'engine.settings.lineJumps',
      icon: Spline,
      label: t('lineJumps'),
      palette: true,
      detail: (e) => (e.getSettings().lineJumps ? 'on' : 'off'),
      run: (e) => e.updateSettings({ lineJumps: !e.getSettings().lineJumps }),
    },
    ...GRID_STYLES.map(
      (g): CommandDefinition => ({
        id: `engine.settings.grid.${g.value}`,
        icon: Grid3x3,
        label: g.value === 'none' ? t('hideTheGrid') : t('gridLabel', { label: g.label.toLowerCase() }),
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
        label: t('gridSizeN', { n }),
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
        label: t('backgroundName', { name: b.name }),
        palette: true,
        when: (e) => e.getSettings().background.toLowerCase() !== b.color.toLowerCase(),
        disabledReason: current,
        run: (e) => e.updateSettings({ background: b.color }),
      }),
    ),
  ];
}
