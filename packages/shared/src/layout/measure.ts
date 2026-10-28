// Text size without a DOM: an estimate from a per-character width table for Freero's UI font
// (Inter), slightly generous so laid-out boxes never clip their text. The web re-measures with the
// real font whenever someone edits an element (`normalize`); this only has to be close.

/** Advance width in em of one character of Inter (regular). */
function charEm(c: number): number {
  if (c === 32) return 0.28;
  if (c < 128) {
    const ch = String.fromCharCode(c);
    if ('il.,:;|!\'`'.includes(ch)) return 0.27;
    if ('jI()[]{}/\\'.includes(ch)) return 0.34;
    if ('ftr-"'.includes(ch)) return 0.38;
    if ('mw'.includes(ch)) return 0.84;
    if ('MW'.includes(ch)) return 0.92;
    if (ch >= 'a' && ch <= 'z') return 0.56;
    if (ch >= 'A' && ch <= 'Z') return 0.68;
    if (ch >= '0' && ch <= '9') return 0.6;
    return 0.56;
  }
  if (c >= 0x2e80) return 1.0; // CJK, symbols, emoji (surrogate pairs are counted once below)
  return 0.62;
}

export function textWidth(text: string, fontSize: number, bold = false): number {
  let em = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00) {
      em += 1.15;
      i++;
      continue;
    }
    em += charEm(c);
  }
  return em * fontSize * (bold ? 1.06 : 1) * 1.03;
}

/** Lines of `text` wrapped at `maxWidth` (words; a word longer than a line is broken). */
export function wrapLines(text: string, fontSize: number, maxWidth: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const next = line + word;
      if (!line || textWidth(next.trimEnd(), fontSize, bold) <= maxWidth) {
        line = next;
        continue;
      }
      out.push(line.trimEnd());
      line = word.trimStart();
      while (line && textWidth(line, fontSize, bold) > maxWidth) {
        let cut = line.length - 1;
        while (cut > 1 && textWidth(line.slice(0, cut), fontSize, bold) > maxWidth) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Box hugging `text` (wrapped at `maxWidth`), without padding. */
export function measureText(text: string, o: { fontSize: number; maxWidth: number; bold?: boolean; lineHeight?: number }): { w: number; h: number } {
  const lines = wrapLines(text, o.fontSize, o.maxWidth, o.bold);
  const w = Math.max(0, ...lines.map((l) => textWidth(l, o.fontSize, o.bold)));
  return { w: Math.ceil(w), h: Math.ceil(lines.length * o.fontSize * (o.lineHeight ?? 1.4)) };
}
