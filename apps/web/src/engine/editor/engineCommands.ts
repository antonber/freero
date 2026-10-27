// Engine-owned commands. They go through the same registry as feature commands, so menus and
// shortcuts treat them uniformly (and features can call editor.runCommand('engine.<verb>')).
import {
  BringToFront,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Group,
  Link2,
  Lock,
  Maximize,
  MousePointerSquareDashed,
  Scissors,
  SendToBack,
  Trash2,
  Ungroup,
} from 'lucide-react';
import type { CommandDefinition, Editor } from '../api';
import type { EngineCore } from '../runtime/core';
import { nextZoomStep } from '../camera/camera';

/** Commands whose shortcut is display-only: the keyboard path is the native copy/cut/paste event. */
export const NATIVE_CLIPBOARD_COMMANDS = new Set(['engine.copy', 'engine.cut', 'engine.paste']);

export function elementLink(boardPath: string, id: string): string {
  const url = new URL(boardPath, window.location.origin);
  url.search = '';
  url.searchParams.set('el', id);
  return url.toString();
}

export function createEngineCommands(core: EngineCore): CommandDefinition[] {
  const sel = (e: Editor) => e.getSelection();
  const hasSel = (e: Editor) => sel(e).length > 0;
  const selected = (e: Editor) => sel(e).map((id) => e.getElement(id)!).filter(Boolean);
  /** Zoom commands are the user's own camera moves (shortcuts, zoom controls): see Editor 'camera-user'. */
  const user = (fn: () => void) => core.editor.asUser(fn);
  return [
    { id: 'engine.undo', label: 'Undo', shortcut: 'mod+z', run: (e) => e.undo() },
    { id: 'engine.redo', label: 'Redo', shortcut: 'mod+shift+z', run: (e) => e.redo() },
    { id: 'engine.redoAlt', label: 'Redo', shortcut: 'mod+y', run: (e) => e.redo() },
    { id: 'engine.cut', icon: Scissors, label: 'Cut', shortcut: 'mod+x', menus: ['context'], when: hasSel, run: (e) => e.cut() },
    { id: 'engine.copy', icon: Copy, label: 'Copy', shortcut: 'mod+c', minRole: 'viewer', menus: ['context'], when: hasSel, run: (e) => e.copy() },
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
    { id: 'engine.duplicate', icon: CopyPlus, label: 'Duplicate', shortcut: 'mod+d', menus: ['context'], when: hasSel, run: (e) => e.duplicate(sel(e)) },
    {
      id: 'engine.delete',
      icon: Trash2,
      label: 'Delete',
      shortcut: 'delete',
      menus: ['context'],
      when: hasSel,
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
      run: (e) => e.group(sel(e)),
    },
    {
      id: 'engine.ungroup',
      icon: Ungroup,
      label: 'Ungroup',
      shortcut: 'mod+shift+g',
      menus: ['context'],
      when: (e) => selected(e).some((el) => el.groupId),
      run: (e) => e.ungroup(sel(e)),
    },
    { id: 'engine.bringToFront', icon: BringToFront, label: 'Bring to front', shortcut: 'mod+]', menus: ['context'], when: hasSel, run: (e) => e.bringToFront(sel(e)) },
    { id: 'engine.sendToBack', icon: SendToBack, label: 'Send to back', shortcut: 'mod+[', menus: ['context'], when: hasSel, run: (e) => e.sendToBack(sel(e)) },
    {
      id: 'engine.lock',
      icon: Lock,
      label: 'Lock / unlock',
      shortcut: 'mod+shift+l',
      menus: ['context'],
      when: hasSel,
      run: (e) => {
        const els = selected(e);
        const lock = !els.every((el) => el.locked);
        e.updateMany(els.map((el) => ({ id: el.id, patch: { locked: lock } })));
      },
    },
    {
      id: 'engine.copyLink',
      icon: Link2,
      label: 'Copy link to object',
      minRole: 'viewer',
      menus: ['context'],
      when: (e) => sel(e).length === 1,
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
      run: (e) => user(() => e.zoomToFit(sel(e), { maxZoom: 2 })),
    },
    { id: 'engine.zoom100', label: 'Zoom to 100%', shortcut: 'shift+0', minRole: 'viewer', run: (e) => user(() => e.zoomTo(1)) },
    { id: 'engine.zoomIn', label: 'Zoom in', shortcut: 'mod+=', minRole: 'viewer', run: (e) => user(() => e.zoomTo(nextZoomStep(e.getCamera().zoom, 1))) },
    { id: 'engine.zoomOut', label: 'Zoom out', shortcut: 'mod+-', minRole: 'viewer', run: (e) => user(() => e.zoomTo(nextZoomStep(e.getCamera().zoom, -1))) },
    {
      id: 'engine.editText',
      label: 'Edit text',
      shortcut: 'enter',
      when: (e) => {
        const els = selected(e);
        return els.length === 1 && !!e.getDefinition(els[0].type)?.textField && !els[0].locked;
      },
      run: (e) => e.startEditing(sel(e)[0], { selectAll: true }),
    },
  ];
}
