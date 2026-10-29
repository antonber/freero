// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { docToMarkdown, markdownToDoc } from '@freero/shared';
import { docSchema } from './DocEditorImpl';

const MARKDOWN = `# Decision

We go with **option B**, see [the board](https://freero.test/board/b1).

1. Draft
2. Review
   - with legal

- [x] Agreed
- [ ] Announced

| Who | When |
| --- | --- |
| Ann | Friday |

\`\`\`ts
const ok = true;
\`\`\`

> Write it down.

![Live board](freero://board/b1#frame2)

---
`;

it('Markdown imported into the editor exports as the same Markdown (the blocks Freero writes are the ones the editor keeps)', () => {
  const editor = BlockNoteEditor.create({ schema: docSchema });
  editor.replaceBlocks(editor.document, markdownToDoc(MARKDOWN) as unknown as PartialBlock<typeof docSchema.blockSchema>[]);
  expect(docToMarkdown(editor.document as never)).toBe(MARKDOWN);
});
