// Right-click menu: engine items + feature commands with menus: ['context'].
import { useStore } from 'zustand';
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
import { Menu, type IconProp, type MenuItem } from '@ui';
import { useCore } from '../context';
import type { EngineCore } from '../runtime/core';
import { ROLE_RANK } from '../runtime/core';
import { formatShortcut } from '../runtime/shortcuts';

const ICONS: Record<string, IconProp> = {
  'engine.cut': Scissors,
  'engine.copy': Copy,
  'engine.paste': ClipboardPaste,
  'engine.duplicate': CopyPlus,
  'engine.bringToFront': BringToFront,
  'engine.sendToBack': SendToBack,
  'engine.group': Group,
  'engine.ungroup': Ungroup,
  'engine.lock': Lock,
  'engine.copyLink': Link2,
  'engine.delete': Trash2,
  'engine.selectAll': MousePointerSquareDashed,
  'engine.zoomToFit': Maximize,
};

const WITH_SELECTION = [
  ['engine.cut', 'engine.copy', 'engine.paste', 'engine.duplicate'],
  ['engine.bringToFront', 'engine.sendToBack'],
  ['engine.group', 'engine.ungroup', 'engine.lock', 'engine.copyLink'],
];
const WITHOUT_SELECTION = [['engine.paste', 'engine.selectAll', 'engine.zoomToFit']];

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
    return {
      id,
      label: reg.def.label,
      icon: ICONS[id],
      shortcut: reg.def.shortcut ? formatShortcut(reg.def.shortcut) : undefined,
      danger: id === 'engine.delete',
      onSelect: () => editor.runCommand(id),
    };
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
    [...core.registry.commands.values()]
      .filter(({ def, feature }) => feature !== 'engine' && def.menus?.includes('context'))
      .map(({ def }) => item(def.id)),
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
