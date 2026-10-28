// The shortcut reference's source of truth: every binding the registry (tools, commands, element
// types' declared `keys`) and the keyboard router answer, for one role. Built on demand from the live registry, so it can't drift.
import type { Role } from '@freero/shared';
import type { ActionEntry, CommandDefinition, Editor, ShortcutEntry } from '../api';
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
    add({ id: def.id, label: def.label, shortcuts: [def.shortcut, ...(def.extraShortcuts ?? [])], kind: 'command', feature });
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

const ROLE_REASON: Record<Role, string> = {
  owner: 'Only the board owner can do this',
  editor: 'Needs edit access to this board',
  commenter: 'Needs comment access to this board',
  viewer: '',
};

/** A grouped command's label as one phrase: 'Select all' + 'Of this type' → 'Select all of this type'. */
export function actionLabel(def: Pick<CommandDefinition, 'label' | 'group'>): string {
  const { label, group } = def;
  if (!group || label.toLowerCase().startsWith(group.split(' ')[0].toLowerCase())) return label;
  return `${group} ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/** Commands a person can invoke: those with a shortcut or a menu entry, unless they opt in or out. */
export const inPalette = (def: CommandDefinition) => def.palette ?? (!!def.shortcut || !!def.menus?.length);

/**
 * The command palette's source of truth: every tool and every user-facing command, whether it can
 * run right now and, if not, why. Same registry as `listShortcuts`, so the two can't disagree.
 * Commands with the same label from the same feature (Redo: mod+shift+z / mod+y) are one row.
 */
export function listActions(
  registry: Registry,
  ctx: { can: (minRole: Role) => boolean; scoped: (feature: string) => Editor },
): ActionEntry[] {
  const out: ActionEntry[] = [];
  for (const { def, feature } of registry.tools) {
    const minRole = def.minRole ?? 'editor';
    out.push({
      id: def.id,
      kind: 'tool',
      label: def.label,
      shortcuts: def.shortcut ? [def.shortcut] : [],
      feature,
      icon: def.icon,
      disabledReason: ctx.can(minRole) ? null : ROLE_REASON[minRole],
    });
  }
  const rows = new Map<string, ActionEntry>();
  for (const { def, feature } of registry.commands.values()) {
    if (!inPalette(def)) continue;
    const label = actionLabel(def);
    const twin = rows.get(`${feature}\u0000${label}`);
    if (twin) {
      if (def.shortcut && !twin.shortcuts.includes(def.shortcut)) twin.shortcuts.push(def.shortcut);
      continue;
    }
    const minRole = def.minRole ?? 'editor';
    const ed = ctx.scoped(feature);
    let disabledReason: string | null = null;
    if (!ctx.can(minRole)) disabledReason = ROLE_REASON[minRole];
    else if (def.when && !def.when(ed)) {
      const why = typeof def.disabledReason === 'function' ? def.disabledReason(ed) : def.disabledReason;
      disabledReason = why || 'Not available right now';
    }
    const detail = disabledReason === null ? def.detail?.(ed) : undefined;
    const row: ActionEntry = { id: def.id, kind: 'command', label, shortcuts: def.shortcut ? [def.shortcut] : [], feature, icon: def.icon, disabledReason };
    if (detail) row.detail = detail;
    rows.set(`${feature}\u0000${label}`, row);
    out.push(row);
  }
  return out;
}
