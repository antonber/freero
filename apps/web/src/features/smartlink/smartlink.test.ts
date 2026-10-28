import { describe, expect, it } from 'vitest';
import { pastedObject } from './lib/address';

const ORIGIN = 'https://freero.example';

describe('pasting an address', () => {
  it('claims only this app’s board and item URLs and freero:// addresses, never another site’s /board/ page', () => {
    expect(pastedObject(`${ORIGIN}/board/abc123?el=s1`, ORIGIN)?.uri).toBe('freero://board/abc123#s1');
    expect(pastedObject(`${ORIGIN}/board/abc123`, ORIGIN)?.uri).toBe('freero://board/abc123');
    expect(pastedObject('freero://template/t9', ORIGIN)?.uri).toBe('freero://template/t9');
    // Someone else's site with the same path shape is a plain web link (the link card's).
    expect(pastedObject('https://other.example/board/abc123', ORIGIN)).toBeNull();
    // Prose that merely contains an address is text, not a chip.
    expect(pastedObject(`see ${ORIGIN}/board/abc123`, ORIGIN)).toBeNull();
    // An address whose item id could be anything (markup, a script) is no address.
    expect(pastedObject(`${ORIGIN}/board/abc123?el=<img>`, ORIGIN)).toBeNull();
  });
});
