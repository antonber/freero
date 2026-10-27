// Pasting plain text: when does it become stickies? (pure, unit-tested)
//
// The rule, shared by the sticky and text features through import priorities (they never import
// each other): stickies claim a paste first (importPriority 5) and only take
//   1. a LIST: two or more non-empty lines that are bulleted / numbered (most of them), or that
//      are all short and don't read as one paragraph wrapped over several lines — one sticky per
//      line, bullet / number prefixes stripped; also when the clipboard HTML holds a list (<li>);
//   2. ANY text while stickies are selected (one sticky per list item, else one sticky).
// Everything else (prose: a sentence, paragraphs, long lines) is left to the text feature
// (importPriority 0), which makes a text box.

/** Bullet or number prefix of a list line: "- ", "* ", "• ", "1. ", "2) ", "a) ", "[ ] ", "[x] "… */
const PREFIX = /^(?:[-*+•◦▪‣·–—>]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|\[[ xX]\])\s+/;
/** Lines this short (characters) count as list items even without bullets. */
export const SHORT_LINE = 60;
/** Most stickies one paste creates. */
export const MAX_STICKIES = 100;

export const stripPrefix = (line: string): string => line.replace(PREFIX, '').trim();

const linesOf = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** A line that continues the previous one (a paragraph hard-wrapped by an email client). */
const continues = (prev: string, next: string) => !/[.!?:;)"'”’]$/.test(prev) && /^[a-z]/.test(next);

/**
 * The items of `text` when it is a list (see the rule above), else null. `html` (the clipboard's
 * HTML flavour) marks a list copied from a document even when its plain text lost the bullets.
 */
export function listItems(text: string | null, html: string | null = null): string[] | null {
  if (!text) return null;
  const lines = linesOf(text);
  if (lines.length < 2 || lines.some((l) => l.includes('\t'))) return null; // tabs = a table
  const bulleted = lines.filter((l) => PREFIX.test(l)).length;
  const htmlList = !!html && (html.match(/<li[\s>]/gi)?.length ?? 0) >= 2;
  let list = htmlList || bulleted >= Math.ceil(lines.length * 0.6);
  if (!list && lines.every((l) => l.length <= SHORT_LINE)) {
    let wrapped = 0;
    for (let i = 1; i < lines.length; i++) if (continues(lines[i - 1], lines[i])) wrapped++;
    list = wrapped * 2 < lines.length - 1;
  }
  if (!list) return null;
  const items = lines.map(stripPrefix).filter(Boolean);
  return items.length ? items.slice(0, MAX_STICKIES) : null;
}
