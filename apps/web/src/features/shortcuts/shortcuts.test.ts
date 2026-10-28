import { describe, expect, it } from 'vitest';
import type { ShortcutEntry } from '@engine';
import { buildSheet } from './lib/sheet';

const entries: ShortcutEntry[] = [
  { id: 'engine.duplicate', label: 'Duplicate', shortcuts: ['mod+d'], kind: 'command', feature: 'engine' },
  { id: 'engine.zoomIn', label: 'Zoom in', shortcuts: ['mod+='], kind: 'command', feature: 'engine' },
  { id: 'shortcuts.open', label: 'Keyboard shortcuts', shortcuts: ['shift+/'], kind: 'command', feature: 'shortcuts' },
  { id: 'sticky', label: 'Sticky note', shortcuts: ['n'], kind: 'tool', feature: 'sticky' },
];
const labels = (q: string, apple: boolean) => buildSheet(entries, q, apple).flatMap((s) => s.rows.map((r) => r.label));

describe('shortcut sheet search', () => {
  it('finds a command by the keys as this platform prints them (Ctrl+D on Windows, ⌘D on a Mac)', () => {
    expect(labels('ctrl+d', false)).toEqual(['Duplicate']);
    expect(labels('⌘d', true)).toEqual(['Duplicate']);
    expect(labels('ctrl+d', true)).toEqual([]);
  });

  it('shows the keys people press (? and +), not the physical ones the router matches', () => {
    const rows = buildSheet(entries, '', false).flatMap((s) => s.rows);
    expect(rows.find((r) => r.label === 'Keyboard shortcuts')?.keys).toEqual(['?']);
    expect(rows.find((r) => r.label === 'Zoom in')?.keys).toEqual(['mod+plus']);
  });
});
