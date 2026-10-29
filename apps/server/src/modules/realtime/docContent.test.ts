import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { DOC_FRAGMENT, docToMarkdown, markdownToDoc } from '@freero/shared';
import { readDocBlocks, writeDocBlocks } from './docContent';
import { restoreInto } from './restore';

let n = 0;
const id = () => `b${++n}`;

const MARKDOWN = `# Launch plan

Ship **bold** and _quiet_ things, with \`code\`, ~~old~~ and a [link](https://example.com/a).

## Steps

1. Draft
2. Review
   - with design
   - with legal
3. Ship

- [x] Kick-off
- [ ] Retro

> Decisions stay written down.

| Owner | Due |
| --- | --- |
| Ann | Friday |

\`\`\`ts
const answer = 42;
\`\`\`

![Diagram](/uploads/abc123.png)

![Live board](freero://board/b0ard1#frame9)
`;

it('Markdown written into a doc by the server and read back is the same Markdown (headings, nested lists, checklists, tables, code, links, embeds)', () => {
  const doc = new Y.Doc();
  writeDocBlocks(doc, markdownToDoc(MARKDOWN), id);
  // Through a fresh replica, as another instance or the editor would load it.
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
  expect(docToMarkdown(readDocBlocks(replica))).toBe(MARKDOWN);
});

it('restoring a doc version brings its text back as a new change, and leaves the comments written since', () => {
  const live = new Y.Doc();
  writeDocBlocks(live, markdownToDoc('# Plan\n\nThe first draft\n'), id);
  const version = Y.encodeStateAsUpdate(live);
  writeDocBlocks(live, markdownToDoc('A paragraph added later\n'), id);
  live.getMap('comments').set('t:t1', { kind: 'thread', id: 't1', x: 0, y: 0, elementId: 'b1', createdAt: 1, createdBy: 'u1' });
  // The restore travels to another replica as an ordinary update.
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(live));
  live.on('update', (u: Uint8Array) => Y.applyUpdate(other, u));

  restoreInto(live, version, ['comments']);
  other.getXmlFragment(DOC_FRAGMENT);
  expect(docToMarkdown(readDocBlocks(other))).toBe('# Plan\n\nThe first draft\n');
  expect(other.getMap('comments').has('t:t1')).toBe(true);
  // Restoring to what the doc already is writes nothing (it can't overwrite someone's edit).
  let updates = 0;
  live.on('update', () => updates++);
  expect(restoreInto(live, version, ['comments'])).toBe(0);
  expect(updates).toBe(0);
});
