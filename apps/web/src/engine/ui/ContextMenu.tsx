// Right-click menu: engine items + feature commands with menus: ['context'].
import { useStore } from 'zustand';
import { Menu, type MenuItem } from '@ui';
import { useCore } from '../context';
import type { CommandDefinition } from '../api';
import type { EngineCore } from '../runtime/core';
import { ROLE_RANK } from '../runtime/core';
import type { Registered } from '../runtime/registry';
import { formatShortcut } from '../runtime/shortcuts';

const WITH_SELECTION = [
  ['engine.cut', 'engine.copy', 'engine.paste', 'engine.duplicate'],
  ['engine.bringToFront', 'engine.sendToBack'],
  ['engine.group', 'engine.ungroup', 'engine.lock', 'engine.copyLink'],
];
const WITHOUT_SELECTION = [['engine.paste', 'engine.selectAll', 'engine.zoomToFit']];

/** A command as a menu item (label, icon, shortcut). */
export function commandItem({ def }: Registered<CommandDefinition>, onSelect: () => void): MenuItem {
  return {
    id: def.id,
    label: def.label,
    icon: def.icon,
    shortcut: def.shortcut ? formatShortcut(def.shortcut) : undefined,
    danger: def.id === 'engine.delete',
    onSelect,
  };
}

/**
 * Menu items for commands, folding commands that share a `group` into one "<group> ▸" submenu
 * placed where the group's first command would be.
 */
export function groupCommands(
  regs: Array<Registered<CommandDefinition>>,
  toItem: (reg: Registered<CommandDefinition>) => MenuItem,
): MenuItem[] {
  const out: MenuItem[] = [];
  const subs = new Map<string, MenuItem[]>();
  for (const reg of regs) {
    const group = reg.def.group;
    if (!group) {
      out.push(toItem(reg));
      continue;
    }
    let list = subs.get(group);
    if (!list) {
      subs.set(group, (list = []));
      out.push({ id: `group:${group}`, label: group, icon: reg.def.icon, submenu: list, onSelect: () => undefined });
    }
    list.push(toItem(reg));
  }
  return out;
}

/** Builds menu items from engine + feature context commands available right now. */
export function contextCommandItems(core: EngineCore, opts: { withZOrder?: boolean } = {}): MenuItem[] {
  const editor = core.editor;
  const role = editor.getRole();
  const hasSel = editor.getSelection().length > 0;
  const available = (id: string) => {
    const reg = core.registry.commands.get(id);
    if (!reg) return null;
    const { def, feature } = reg;
    if (ROLE_RANK[role] < ROLE_RANK[def.minRole ?? 'editor']) return null;
    if (def.when && !def.when(core.scoped(feature))) return null;
    return reg;
  };
  const item = (id: string): MenuItem | null => {
    const reg = available(id);
    if (!reg) return null;
    return commandItem(reg, () => editor.runCommand(id));
  };
  const groups = (hasSel ? WITH_SELECTION : WITHOUT_SELECTION).filter(
    (g) => opts.withZOrder !== false || !g.includes('engine.bringToFront'),
  );
  const out: MenuItem[] = [];
  const push = (items: Array<MenuItem | null>) => {
    const real = items.filter((i): i is MenuItem => !!i);
    if (!real.length) return;
    if (out.length) out.push({ divider: true });
    out.push(...real);
  };
  for (const g of groups) push(g.map(item));
  push(
    groupCommands(
      [...core.registry.commands.values()].filter(
        ({ def, feature }) => feature !== 'engine' && def.menus?.includes('context') && !!available(def.id),
      ),
      (reg) => item(reg.def.id)!,
    ),
  );
  if (hasSel) push([item('engine.delete')]);
  return out;
}

export function ContextMenu() {
  const core = useCore();
  const menu = useStore(core.ui, (s) => s.contextMenu);
  useStore(core.ui, (s) => s.selection);
  if (!menu) return null;
  const items = contextCommandItems(core);
  if (!items.length) return null;
  const anchor = new DOMRect(menu.x, menu.y, 0, 0);
  return (
    <Menu
      open
      // Deferred so a command run from the menu can still read where it was opened (paste).
      onClose={() => setTimeout(() => core.ui.setState({ contextMenu: null }), 0)}
      anchor={anchor}
      side="bottom"
      align="start"
      minWidth={230}
      items={items}
      aria-label="Context menu"
    />
  );
}
