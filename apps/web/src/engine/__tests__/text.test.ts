// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { plainToRichText, richTextToPlain, sanitizeRichText } from '../text/sanitize';
import { applyFormatToHtml, formatStateOfHtml } from '../text/formatHtml';
import { fitFontSize } from '../text/autofit';
import { parseFontSize } from '../ui/TextStyleControls';

describe('sanitizeRichText', () => {
  it('removes scripts, handlers and unsafe links but keeps the allowed subset', () => {
    const out = sanitizeRichText(
      '<b onclick="x()">hi</b><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a><a href="https://ok.dev" target="_blank">ok</a>',
    );
    expect(out).not.toMatch(/script|onclick|onerror|img|javascript|target/);
    expect(out).toContain('<b>hi</b>');
    expect(out).toContain('<a href="https://ok.dev">ok</a>');
  });

  it('normalizes what contenteditable produces into the stored subset', () => {
    const out = sanitizeRichText(
      '<strong>a</strong><em>b</em><font color="#ff0000">c</font><span style="font-weight: bold; font-size: 40px">d</span><div>e</div>',
    );
    expect(out).toBe('<b>a</b><i>b</i><span style="color: rgb(255, 0, 0);">c</span><b>d</b><p>e</p>');
  });

  it('treats an emptied editor as empty text', () => {
    expect(sanitizeRichText('<br>')).toBe('');
  });
});

describe('richTextToPlain', () => {
  it('keeps line breaks from <br>, paragraphs and divs', () => {
    expect(richTextToPlain('a<div>b</div><div>c</div>')).toBe('a\nb\nc');
    expect(richTextToPlain('<p>a</p><p>b &amp; c</p>')).toBe('a\nb & c');
    expect(richTextToPlain(plainToRichText('x < y\nz'))).toBe('x < y\nz');
  });
});

describe('whole-text formatting (selected, not editing)', () => {
  it('bold turns on for partially bold text, then off again', () => {
    const on = applyFormatToHtml('a <b>b</b>', 'bold');
    expect(formatStateOfHtml(on).bold).toBe(true);
    const off = applyFormatToHtml(on, 'bold');
    expect(off).not.toMatch(/<b>/);
    expect(richTextToPlain(off)).toBe('a b');
  });

  it('bullets turn each line into a list item and back', () => {
    const list = applyFormatToHtml('one<br>two', 'bullets');
    expect(list).toBe('<ul><li>one</li><li>two</li></ul>');
    expect(richTextToPlain(applyFormatToHtml(list, 'bullets'))).toBe('one\ntwo');
  });
});

describe('auto-fit text', () => {
  it('shrinks the font as content grows', () => {
    const short = fitFontSize('Hi', 'sans', 180, 180, { max: 60 });
    const medium = fitFontSize('A few more words here', 'sans', 180, 180, { max: 60 });
    const long = fitFontSize('A few more words here '.repeat(8), 'sans', 180, 180, { max: 60 });
    expect(short).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(long);
  });

  it('prefers a smaller size over breaking a word in the middle', () => {
    // Regression: "Gamma" used to fit "Gamm/a" on two lines at the max size.
    const size = fitFontSize('Gamma', 'sans', 160, 400, { max: 200 });
    const oneLineWidth = size * 0.55 * 5; // fallback metric without canvas: 0.55em per glyph
    expect(oneLineWidth).toBeLessThanOrEqual(160);
  });

  it('never goes below the minimum, even for text that cannot fit', () => {
    expect(fitFontSize('word '.repeat(500), 'sans', 100, 100, { min: 8, max: 40 })).toBe(8);
  });
});

describe('custom text size field (shared format control)', () => {
  it('accepts "18px" / "12.5" but never writes an empty, zero or non-numeric size', () => {
    expect(parseFontSize(' 18px ')).toBe(18);
    expect(parseFontSize('12.54')).toBe(12.5);
    for (const bad of ['', '  ', 'px', 'abc', '0', '-4', '3', 'Infinity', '5000']) expect(parseFontSize(bad)).toBeNull();
  });
});
