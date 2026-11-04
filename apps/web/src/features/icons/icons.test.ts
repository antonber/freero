import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { iconIndex, searchIcons } from './lib/iconIndex';
import { cleanNodes, IconSvg } from './lib/nodes';
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

  it('an icon drawn on the board — and so in exports, which draw the same component — carries nothing that can run or load, whatever its element says (#4)', () => {
    const crafted = [
      ['foreignObject', { width: 24, height: 24 }],
      ['use', { href: 'https://evil.test/sprite.svg#x' }],
      ['path', { d: 'M4 4h16', onLoad: 'alert(1)', onload: 'alert(1)', fill: 'url(https://evil.test/x)', stroke: '#232f3e', style: 'x', 'xlink:href': 'https://evil.test' }],
      ['rect', { x: 1, y: 1, width: 4, height: 4, transform: 'translate(1)" onload="alert(2)', fill: '#ff9900' }],
    ];
    for (const art of [undefined, 'mono', 'color'] as const) {
      const html = renderToStaticMarkup(createElement(IconSvg, { nodes: crafted, color: '#000', strokeWidth: 2, art, viewBox: '0 0 24 24" onload="alert(3)' }));
      expect(html).toContain('d="M4 4h16"');
      expect(html).toContain('fill="#ff9900"');
      expect(html).not.toMatch(/script|alert|on[a-z]+=|href|url\(|foreignObject|<use|style="[^"]*x/i);
    }
  });
});
