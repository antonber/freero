// Mind maps as outlines, both ways (KAI-115): paste builds a map, "Copy as outline" gets it back.
import { describe, expect, it } from 'vitest';
import type { MindmapElement } from '@freero/shared';
import { createTestBoard, richTextToPlain, type Editor } from '@engine';
import manifest from './feature';
import mindmapDef from './element';
import { addChild, currentIndex, newRoot } from './lib/actions';
import { mapsToOutline, outlineFromPaste } from './lib/outline';
import { sideOf, type MindNode } from './lib/tree';

const bundle = { manifest, elements: [mindmapDef], tools: [], formats: [], panels: [], commands: [] };

interface Tree {
  text: string;
  kids: Tree[];
}
const treeOf = (ed: Editor): Tree[] => {
  const index = currentIndex(ed);
  const walk = (n: MindNode): Tree => ({ text: richTextToPlain(ed.getElement<MindmapElement>(n.id)!.text), kids: (index.kids.get(n.id) ?? []).map(walk) });
  return [...index.byId.values()].filter((n) => !n.parentId).map(walk);
};
const byText = (t: Tree[]): Tree[] => t.map((n) => ({ text: n.text, kids: byText(n.kids) })).sort((a, b) => a.text.localeCompare(b.text));
const paste = (ed: Editor, text: string) => mindmapDef.importData!(ed, { files: [], text, html: null }, { x: 0, y: 0 });
const leaf = (text: string): Tree => ({ text, kids: [] });
/** The root's branches on each side, top to bottom. */
const sides = (ed: Editor) => {
  const index = currentIndex(ed);
  const root = [...index.byId.values()].find((n) => !n.parentId)!;
  const name = (n: MindNode) => richTextToPlain(ed.getElement<MindmapElement>(n.id)!.text);
  const kids = index.kids.get(root.id) ?? [];
  return { right: kids.filter((k) => sideOf(k, root) === 'right').map(name), left: kids.filter((k) => sideOf(k, root) === 'left').map(name) };
};

describe('outlines', () => {
  it('a pasted 3-level outline becomes a map with that tree in one undo step; copied out as an outline, it pastes back identical', () => {
    const board = createTestBoard({ users: ['ann'], features: [bundle] });
    try {
      const [ed] = board.editors('mindmap');
      const text = ['- Launch', '  - Marketing', '    - Blog', '    - Webinar', '  - Product', '    - Beta', '      - Invites', '  - Sales', '  - Support', '    - Docs'].join('\n');
      expect(paste(ed, text)).toBe(true);
      const first = treeOf(ed);
      expect(byText(first)).toEqual([
        {
          text: 'Launch',
          kids: [
            { text: 'Marketing', kids: [leaf('Blog'), leaf('Webinar')] },
            { text: 'Product', kids: [{ text: 'Beta', kids: [leaf('Invites')] }] },
            leaf('Sales'),
            { text: 'Support', kids: [leaf('Docs')] },
          ],
        },
      ]);
      const firstSides = sides(ed);
      expect(firstSides.right.length + firstSides.left.length).toBe(4);
      ed.undo();
      expect(treeOf(ed)).toEqual([]);
      ed.redo();
      const root = [...currentIndex(ed).byId.values()].find((n) => !n.parentId)!;
      const copied = mapsToOutline(currentIndex(ed), [root.id], (id) => ed.getElement<MindmapElement>(id)!.text);
      ed.remove([root.id]);
      expect(paste(ed, copied.text)).toBe(true);
      // Same tree, same sibling order on each side (a two-sided map lists its branches alternating).
      // (Across the two sides there is no order: branches level with each other tie.)
      expect(byText(treeOf(ed))).toEqual(byText(first));
      expect(sides(ed)).toEqual(firstSides);
    } finally {
      board.destroy();
    }
  });

  it('an outline pasted while a topic is selected grows under that topic, after its children', () => {
    const board = createTestBoard({ users: ['ann'], features: [bundle] });
    try {
      const [ed] = board.editors('mindmap');
      const root = ed.create(newRoot({ x: 0, y: 0 }));
      ed.update<MindmapElement>(root, { text: 'Root' });
      addChild(ed, root);
      ed.stopEditing();
      const a = ed.getSelection()[0];
      ed.update<MindmapElement>(a, { text: 'A' });
      addChild(ed, a);
      ed.stopEditing();
      ed.update<MindmapElement>(ed.getSelection()[0], { text: 'Old' });
      ed.select([a]);
      expect(paste(ed, 'One\n  One.1\nTwo')).toBe(true);
      expect(treeOf(ed)).toEqual([{ text: 'Root', kids: [{ text: 'A', kids: [leaf('Old'), { text: 'One', kids: [leaf('One.1')] }, leaf('Two')] }] }]);
    } finally {
      board.destroy();
    }
  });

  it('flat lists, spreadsheet cells and code are not outlines (they stay stickies, tables, text)', () => {
    expect(outlineFromPaste('- Milk\n- Eggs\n- Bread')).toBeNull();
    expect(outlineFromPaste('Name\tOwner\n\tAnn\tLead')).toBeNull();
    expect(outlineFromPaste('function f() {\n  return 1;\n}')).toBeNull();
    expect(outlineFromPaste('Trip\n\tFlights\n\tHotel')).toEqual([{ text: 'Trip', children: [{ text: 'Flights' }, { text: 'Hotel' }] }]);
  });
});
