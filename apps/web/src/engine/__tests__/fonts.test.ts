// The board's typefaces are self-hosted: what the font menu offers must be a face the vendored CSS
// declares with a file that exists, or text silently falls back to a system font (and exports with
// it), and no rule may reach a font CDN at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FONTS } from '../text/fonts';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHEETS = ['ui/fonts/fonts.css', 'engine/text/fonts/fonts.css'].map((p) => path.join(SRC, p));

describe('board typefaces', () => {
  it('every family in the font menu is declared by a vendored @font-face whose file is in the repo, and none loads from another site', () => {
    const declared = new Set<string>();
    for (const sheet of SHEETS) {
      const css = fs.readFileSync(sheet, 'utf8');
      for (const [, body] of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
        declared.add(body.match(/font-family:\s*'([^']+)'/)![1]);
        const url = body.match(/url\('([^']+)'\)/)![1];
        expect(url.startsWith('./files/'), url).toBe(true);
        expect(fs.existsSync(path.join(path.dirname(sheet), url)), url).toBe(true);
      }
    }
    for (const [id, font] of Object.entries(FONTS)) {
      const face = font.stack.split(',')[0].trim().replace(/^'|'$/g, '');
      expect(declared.has(face), `${id}: ${face}`).toBe(true);
    }
  });
});
