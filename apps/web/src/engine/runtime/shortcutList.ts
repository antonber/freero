// The shortcut reference's source of truth: every binding the registry (tools, commands, element
// types' declared `keys`) and the keyboard router answer, for one role. Built on demand from the live registry, so it can't drift.
import type { Role } from '@freero/shared';
import type { ShortcutEntry } from '../api';
import type { Registry } from './registry';
import { ENGINE_KEYS } from '../interaction/keyboard';

export function listShortcuts(registry: Registry, can: (minRole: Role) => boolean): ShortcutEntry[] {
  const out: ShortcutEntry[] = [];
  /** Same label from the same feature (Redo: mod+shift+z and mod+y) is one row with alternatives. */
  const add = (entry: ShortcutEntry) => {
    const twin = out.find((e) => e.feature === entry.feature && e.label === entry.label);
    if (!twin) return void out.push({ ...entry, shortcuts: [...entry.shortcuts] });
    for (const s of entry.shortcuts) if (!twin.shortcuts.includes(s)) twin.shortcuts.push(s);
  };
  for (const { def, feature } of registry.tools) {
    if (!def.shortcut || !can(def.minRole ?? 'editor')) continue;
    add({ id: def.id, label: def.label, shortcuts: [def.shortcut], kind: 'tool', feature });
  }
  for (const { def, feature } of registry.commands.values()) {
    if (!def.shortcut || !can(def.minRole ?? 'editor')) continue;
    add({ id: def.id, label: def.label, shortcuts: [def.shortcut], kind: 'command', feature });
  }
  for (const [type, { def, feature }] of registry.elements) {
    (def.keys ?? []).forEach((k, i) => {
      if (!can(k.minRole ?? 'editor')) return;
      add({ id: `${type}.key.${i}`, label: k.label, shortcuts: k.shortcuts, kind: 'key', feature });
    });
  }
  for (const k of ENGINE_KEYS) {
    if (!can(k.minRole)) continue;
    add({ id: `engine.key.${k.name}`, label: k.label, shortcuts: k.shortcuts, kind: 'key', feature: 'engine' });
  }
  return out;
}
