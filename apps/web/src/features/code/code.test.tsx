import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CodeElement } from '@freero/shared';
import { createTestBoard, type ElementDefinition, type FeatureBundle, type TestBoard } from '@engine';
import manifest from './feature';
import codeDef from './element';
import { highlight } from './lib/highlighter';
import { CodeLines } from './lib/CodeLines';

const bundle: FeatureBundle = { manifest, elements: [codeDef as unknown as ElementDefinition], tools: [], formats: [], panels: [], commands: [] };

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

const SOURCE = 'export function area(r: number): number {\n\tconst pi = 3.14159;\n    return pi * r * r; // squared\n}\n\n/* multi\n   line */';

describe('code blocks', () => {
  it('a pasted ```ts fence becomes a TypeScript block whose tabs, indentation and blank lines survive exactly', async () => {
    board = createTestBoard({ users: ['ann'], features: [bundle] });
    const [ed] = board.editors('code');
    const took = await ed.importData({ files: [], text: '```ts\n' + SOURCE + '\n```\n', html: null }, { x: 0, y: 0 });
    expect(took).toBe(true);
    const block = ed.getElements().find((el): el is CodeElement => el.type === 'code')!;
    expect(block.code).toBe(SOURCE);
    expect(block.language).toBe('typescript');
  });

  it('a ```mermaid fence is left to the diagram importer instead of becoming a code block', async () => {
    board = createTestBoard({ users: ['ann'], features: [bundle] });
    const [ed] = board.editors('code');
    await ed.importData({ files: [], text: '```mermaid\nflowchart LR\n  A --> B\n```', html: null }, { x: 0, y: 0 });
    expect(ed.getElements().some((el) => el.type === 'code')).toBe(false);
  });

  it('highlighting keeps every character on its own line (line numbers stay aligned) and colours keywords', () => {
    const { lines } = highlight(SOURCE, 'typescript');
    expect(lines.map((runs) => runs.map((r) => r.text).join(''))).toEqual(SOURCE.split('\n'));
    expect(lines[0].some((r) => r.text === 'export' && r.scopes.includes('hljs-keyword'))).toBe(true);
    // The block comment spans two lines and keeps its colour on both.
    expect(lines[6].every((r) => r.scopes.includes('hljs-comment'))).toBe(true);
  });

  it('code that contains <script> and markup is shown as text, never turned into elements', () => {
    const evil = '<script>alert(document.cookie)</script>\n<img src=x onerror="alert(1)">';
    for (const language of ['xml', 'auto', 'javascript', 'plaintext']) {
      const html = renderToStaticMarkup(<CodeLines lines={highlight(evil, language).lines} />);
      expect(html).not.toMatch(/<script|<img/i);
      // What shows is exactly the source text.
      const shown = html
        .replace(/<\/div>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, '&');
      expect(shown.trimEnd()).toBe(evil);
      // Only the highlighter's own scope names ever become class names.
      for (const [, cls] of html.matchAll(/class="([^"]*)"/g)) for (const c of cls.split(' ')) expect(c).toMatch(/^(fr-code__line|hljs-[a-z0-9_-]+)$/);
    }
  });
});
