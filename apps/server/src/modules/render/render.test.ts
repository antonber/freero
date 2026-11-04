import { expect, it } from 'vitest';
import { chartCellKey, type BoardElement } from '@freero/shared';
import { boardSvg } from './svg';

const base = { rotation: 0, z: 1, createdBy: 'u', createdAt: 1, updatedAt: 1 };

it('a server export draws a chart from its cells and a team sticker as its picture, not as labelled boxes', () => {
  const chart = { ...base, id: 'c1', type: 'chart', x: 0, y: 0, w: 400, h: 300, kind: 'bar', title: 'Votes', rows: [{ id: 'r1' }, { id: 'r2' }], series: [{ id: 's1' }] } as BoardElement;
  const sticker = { ...base, id: 'e1', type: 'emoji', x: 500, y: 0, w: 64, h: 64, emoji: 'img:/uploads/abcdef12.png', name: 'Wave' } as BoardElement;
  const cells = new Map<string, unknown>([
    [chartCellKey('c1', 'r1', '_'), 'Alpha'],
    [chartCellKey('c1', 'r2', '_'), 'Beta'],
    [chartCellKey('c1', 'r1', 's1'), '3'],
    [chartCellKey('c1', 'r2', 's1'), '6'],
  ]);
  const { svg } = boardSvg({
    elements: [chart, sticker],
    collection: (name) => (name === 'chartCells' ? cells : new Map()),
    imageData: (src) => (src === '/uploads/abcdef12.png' ? 'data:image/png;base64,AAAA' : null),
  });
  // Two bars, Beta's twice as tall as Alpha's, under their labels.
  const bars = [...svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)" rx="[\d.]+" fill="#5B3FF0"\/>/g)].map((m) => Number(m[1]));
  expect(bars).toHaveLength(2);
  expect(bars[1] / bars[0]).toBeCloseTo(2, 1);
  expect(svg).toContain('>Alpha</text>');
  expect(svg).toContain('href="data:image/png;base64,AAAA"');
});

it('an icon is exported with nothing that could run or load, even when its drawing was written straight into the element (#4)', () => {
  const icon = (nodes: unknown, extra: Record<string, unknown> = {}) =>
    ({ ...base, id: 'i1', type: 'icon', x: 0, y: 0, w: 96, h: 96, name: 'x', nodes, color: '#1f1a33', strokeWidth: 2, ...extra }) as BoardElement;
  const crafted = [
    ['path', { d: 'M4 4h16', onload: 'alert(1)', fill: 'url(https://evil.test/x)', style: 'fill:red', href: 'https://evil.test' }],
    ['script', { href: 'https://evil.test/x.js' }],
    ['foreignObject', { width: 24, height: 24 }],
    ['rect', { x: 0, y: 0, width: 10, height: 10, transform: 'translate(1 1)"/><script>alert(2)</script>' }],
    ['circle', { cx: 12, cy: 12, r: 4, fill: '#ff9900' }],
  ];
  for (const el of [icon(crafted), icon(crafted, { art: 'color', viewBox: '0 0 24 24" onload="alert(3)' })]) {
    const { svg } = boardSvg({ elements: [el], collection: () => new Map(), imageData: () => null });
    expect(svg).toContain('<path d="M4 4h16"');
    expect(svg).toContain('fill="#ff9900"');
    expect(svg).not.toMatch(/script|alert|onload|href|url\(|foreignObject|style=/i);
  }
});
