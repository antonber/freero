// Turns the engine's live shortcut list (Editor.getShortcuts) into the sheet's searchable sections.
import type { ShortcutEntry } from '@engine';
import { formatShortcut } from '@ui';

export const SHEET_PANEL = 'shortcuts.sheet';

export interface SheetRow {
  id: string;
  label: string;
  /** Display-ready bindings ('?' instead of 'shift+/'), alternatives in order. */
  keys: string[];
}

export interface SheetSection {
  title: string;
  rows: SheetRow[];
}

/** Engine rows about moving around the board rather than changing it. */
const VIEW_IDS = /zoom|^engine\.key\.(pan|cycle|cycleBack)$/i;

/** 'shift+/' reads as '?', 'mod+=' as 'mod+plus' (what people press, not the physical key). */
export function displayShortcut(s: string): string {
  const lower = s.toLowerCase();
  if (lower === 'shift+/') return '?';
  return lower.replace(/(^|\+)=$/, '$1plus');
}

const humanize = (feature: string) => {
  const words = feature.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function sectionOf(e: ShortcutEntry): string {
  if (e.kind === 'tool') return 'Tools';
  if (e.feature === 'engine') return VIEW_IDS.test(e.id) ? 'View & navigation' : 'Editing';
  return humanize(e.feature);
}

const FIXED = ['Tools', 'Editing', 'View & navigation'];

/**
 * Sections in a stable order (tools, editing, view, then features A–Z), keeping only rows whose
 * label, section or keys (as this platform shows them: "Ctrl+D" / "⌘D") contain every word typed.
 */
export function buildSheet(entries: ShortcutEntry[], query: string, apple?: boolean): SheetSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const sections = new Map<string, SheetRow[]>();
  for (const e of entries) {
    const title = sectionOf(e);
    const keys = e.shortcuts.map(displayShortcut);
    const haystack = [e.label, title, ...keys, ...keys.map((k) => formatShortcut(k, apple))].join(' ').toLowerCase();
    if (!words.every((w) => haystack.includes(w))) continue;
    const rows = sections.get(title) ?? [];
    rows.push({ id: e.id, label: e.label, keys });
    sections.set(title, rows);
  }
  const rank = (t: string) => (FIXED.includes(t) ? FIXED.indexOf(t) : FIXED.length);
  return [...sections.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([title, rows]) => ({ title, rows }));
}
