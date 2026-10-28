import { describe, expect, it } from 'vitest';
import { iconIndex, searchIcons } from './lib/iconIndex';
import { cleanNodes } from './lib/nodes';
import { parseDragPayload, dragPayload } from './lib/insert';

describe('icon library index', () => {
  it('reads a drawable shape for every lucide icon (breaks loudly if a lucide upgrade hides the drawings)', () => {
    const index = iconIndex();
    expect(index.length).toBeGreaterThan(1000);
    expect(index.every((e) => e.nodes.length > 0)).toBe(true);
    // Aliases are searchable: "alarm check" is an old name of alarm-clock-check.
    expect(searchIcons(index, 'alarm check').map((e) => e.name)).toContain('alarm-clock-check');
    expect(searchIcons(index, 'heart')[0].name).toBe('heart');
  });
});

describe('icon drawings from the board are untrusted', () => {
  it('keeps only SVG primitives with geometric attributes: no scripts, links, handlers or styles', () => {
    const crafted = [
      ['script', { src: 'https://evil.test/x.js' }],
      ['a', { href: 'javascript:alert(1)' }],
      ['image', { href: 'https://tracker.test/pixel.png', width: 24, height: 24 }],
      ['path', { d: 'M4 4h16', onClick: 'alert(1)', style: 'fill:url(https://evil.test)', href: '#x', fill: 'url(#leak)' }],
      ['path', { d: 'M0 0"/><script>alert(1)</script>' }],
      ['circle', { cx: 12, cy: 12, r: '2', fill: 'currentColor' }],
    ];
    expect(cleanNodes(crafted)).toEqual([
      ['path', { d: 'M4 4h16' }],
      ['circle', { cx: '12', cy: '12', r: '2', fill: 'currentColor' }],
    ]);
    // The drag-onto-canvas path goes through the same filter.
    const dropped = parseDragPayload(dragPayload({ name: 'x', nodes: crafted as never }));
    expect(dropped?.nodes).toHaveLength(2);
  });
});
