import { describe, expect, it } from 'vitest';
import type { ActionEntry, ShortcutEntry } from '@engine';
import { buildSheet } from './lib/sheet';
import { rankActions } from './lib/palette';

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

describe('command palette ranking', () => {
  const action = (id: string, label: string, extra: Partial<ActionEntry> = {}): ActionEntry => ({
    id,
    kind: 'command',
    label,
    shortcuts: [],
    feature: id.split('.')[0],
    disabledReason: null,
    ...extra,
  });
  const actions = [
    action('arrange.alignLeft', 'Align left', { shortcuts: ['alt+a'], disabledReason: 'Select two or more items' }),
    action('arrange.alignCenter', 'Align center'),
    action('engine.delete', 'Delete', { shortcuts: ['delete'] }),
    action('export.pdf', 'Export frames as PDF…'),
    action('present.start', 'Present'),
    action('sticky', 'Sticky note', { kind: 'tool', shortcuts: ['n'] }),
    action('select-similar.only.emoji', 'Select only stamps'),
  ];
  const ids = (q: string, recent: string[] = []) => rankActions(actions, q, recent, false).map((r) => r.entry.id);

  it('finds actions from abbreviations and several words, but never from letters scattered across words', () => {
    expect(ids('algn cen')[0]).toBe('arrange.alignCenter');
    expect(ids('export pdf')).toEqual(['export.pdf']);
    // s…n…a…p spread over "Select only stamps" is noise, not a match.
    expect(ids('snap')).toEqual([]);
  });

  it('lists recent actions first (even one unavailable right now), but a recent one never beats a clearly better match', () => {
    expect(ids('', ['present.start', 'arrange.alignLeft']).slice(0, 2)).toEqual(['present.start', 'arrange.alignLeft']);
    expect(ids('delete', ['present.start'])[0]).toBe('engine.delete');
  });

  it('keeps an unavailable action listed, but after every runnable match', () => {
    // "Align left" is the better match for "align l", yet it can't run: Align center comes first.
    expect(ids('align l')).toEqual(['arrange.alignCenter', 'arrange.alignLeft']);
  });
});
