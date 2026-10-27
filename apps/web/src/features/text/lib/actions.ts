// Text element creation helpers shared by the tool and paste import.
import type { TextElement } from '@freero/shared';
import { plainToRichText, type NewElement, type Point } from '@engine';
import { DEFAULT_FONT_SIZE, PASTE_MAX_WIDTH } from './constants';
import { measureTextBox, textPadding } from './layout';

export function textDefaults(): Omit<NewElement<'text'>, 'x' | 'y'> {
  return {
    type: 'text',
    text: '',
    fontFamily: 'sans',
    fontSize: DEFAULT_FONT_SIZE,
    textColor: '#17162B',
    align: 'left',
    background: 'transparent',
    autoWidth: true,
    w: 40,
    h: Math.ceil(DEFAULT_FONT_SIZE * 1.3 + textPadding(DEFAULT_FONT_SIZE) * 2),
  };
}

/** An empty auto-width text whose first line's caret sits at `at` (click-to-type). */
export function textAtCaret(at: Point, overrides: Partial<TextElement> = {}): NewElement<'text'> {
  const d = { ...textDefaults(), ...overrides };
  const pad = textPadding(d.fontSize);
  return { ...d, x: Math.round(at.x - pad), y: Math.round(at.y - (d.fontSize * 1.3) / 2 - pad) };
}

/**
 * A text box holding `html`, centered on `at`. Content wider than PASTE_MAX_WIDTH wraps in a
 * fixed-width box instead of becoming one endless line.
 */
export function textBlockAt(at: Point, html: string): NewElement<'text'> {
  const d = textDefaults();
  const natural = measureTextBox(html, d.fontFamily, d.fontSize, null);
  const auto = natural.w <= PASTE_MAX_WIDTH;
  const size = auto ? natural : measureTextBox(html, d.fontFamily, d.fontSize, PASTE_MAX_WIDTH);
  return {
    ...d,
    text: html,
    autoWidth: auto,
    w: size.w,
    h: size.h,
    x: Math.round(at.x - size.w / 2),
    y: Math.round(at.y - size.h / 2),
  };
}

/**
 * Clipboard plain text → RichText for a pasted text box, or null when there's nothing to paste.
 * Keeps every line break (CRLF / CR included); drops leading blank lines and trailing whitespace.
 */
export function pastedTextToRich(text: string | null): string | null {
  if (!text) return null;
  const clean = text.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
  return clean.trim() ? plainToRichText(clean) : null;
}
