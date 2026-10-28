import { describe, expect, it } from 'vitest';
import { normalizeLink, resolveLink } from './lib/link';

const ctx = { origin: 'https://freero.test', boardId: 'b1' };
const stored = (input: string) => {
  const r = normalizeLink(input, ctx);
  return 'link' in r ? r.link : `ERROR: ${r.error}`;
};

describe('saving an item link', () => {
  it("turns this board's copied item link into an in-board jump, keeps other boards as app paths and adds https to bare domains", () => {
    expect(stored('https://freero.test/board/b1?item=abc_12')).toBe('#abc_12');
    expect(stored('https://freero.test/board/b1?el=abc_12')).toBe('#abc_12');
    expect(stored('https://freero.test/board/other?item=abc')).toBe('/board/other?item=abc');
    expect(stored('example.com/roadmap')).toBe('https://example.com/roadmap');
    expect(stored('just some words')).toMatch(/^ERROR/);
    expect(stored('javascript:alert(1)')).toMatch(/^ERROR/);
    expect(stored('')).toBe('');
  });
});

describe('following a link someone else stored', () => {
  it('never follows script, data or obfuscated schemes, and never treats //host as an in-app path', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', '#<img>'])
      expect(resolveLink(bad, ctx.origin), bad).toBeNull();
    expect(resolveLink('//evil.test/x', ctx.origin)).toEqual({ kind: 'url', href: 'https://evil.test/x' });
    expect(resolveLink('#abc', ctx.origin)).toEqual({ kind: 'item', id: 'abc' });
  });
});
