import { expect, it } from 'vitest';
import { pageMarkdown, prefersMarkdown } from './markdown';

const doc = (main: string) => `<!doctype html><html><head><title>T</title><link rel="canonical" href="https://freero.app/vs/x"/></head><body><main>${main}</main></body></html>`;
const body = (md: string) => md.slice(md.indexOf('---\n\n') + 5).trim();

it('a comparison table, a code sample and a nested list keep their structure, so an agent can quote a row or copy the command; decorations and scripts drop out', () => {
  const md = body(
    pageMarkdown(
      doc(
        '<table><caption>Plans</caption><thead><tr><th>Capability</th><th>Freero</th></tr></thead><tbody><tr><td>Licence</td><td><strong>Yes</strong> · MIT | free</td></tr></tbody></table>' +
          '<figure><figcaption>Terminal</figcaption><pre><code>claude mcp add --transport http freero https://freero.app/mcp</code></pre></figure>' +
          '<ul><li>Boards<ul><li>Frames</li></ul></li><li class="card"><span aria-hidden="true">R</span><h3>Reads a board</h3><div>As an outline.</div></li></ul>' +
          '<svg><text>logo</text></svg><script>x()</script><p>See <a href="#setup">the steps</a>.</p>',
      ),
      'https://freero.app/vs/x',
    ),
  );
  expect(md).toBe(
    [
      '**Plans**',
      '| Capability | Freero |\n| --- | --- |\n| Licence | **Yes** · MIT \\| free |',
      'Terminal',
      '```\nclaude mcp add --transport http freero https://freero.app/mcp\n```',
      '- Boards\n  - Frames\n- **Reads a board** As an outline.',
      'See [the steps](https://freero.app/vs/x#setup).',
    ].join('\n\n'),
  );
});

it('Markdown goes to a client that prefers it to HTML, never to a browser’s ordinary Accept', () => {
  expect(prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe(false);
  expect(prefersMarkdown('text/markdown, text/html;q=0.9')).toBe(true);
  expect(prefersMarkdown('text/html, text/markdown;q=0.5')).toBe(false);
  expect(prefersMarkdown('text/markdown;q=0')).toBe(false);
});
