// A doc's document (KAI-162) read and written on the server, in the node layout BlockNote's editor
// writes through y-prosemirror (@freero/shared docs.ts):
//
//   XmlFragment(DOC_FRAGMENT)
//     <blockGroup>
//       <blockContainer id>           one per block
//         <paragraph|heading|…|table attrs = the block's props>
//           XmlText (marks as formatting attributes: { bold: {} }, { link: { href } })
//           — a table: <tableRow><tableCell attrs><tableParagraph>XmlText
//         <blockGroup>                the block's children (optional)
//
// Readers (search, references, the API's doc outline, data exports) go through `readDocBlocks`;
// the server writes (a doc made from Markdown, the API) through `writeDocBlocks`, so the editor
// opens what the server wrote exactly like what it wrote itself. Doc content is untrusted: anything
// unexpected is skipped, never thrown on.
import * as Y from 'yjs';
import { DOC_FRAGMENT, type DocBlock, type DocInline, type DocStyles, type DocTableCell, type DocTableContent, type DocText } from '@freero/shared';

const STYLE_MARKS: Array<keyof DocStyles> = ['bold', 'italic', 'underline', 'strike', 'code'];
/** Deepest nesting read (untrusted content must not blow the stack). */
const MAX_DEPTH = 48;

function inlineOf(text: Y.XmlText): DocInline[] {
  const out: DocInline[] = [];
  for (const op of text.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>) {
    if (typeof op.insert !== 'string' || !op.insert) continue;
    const attrs = op.attributes ?? {};
    const styles: DocStyles = {};
    for (const m of STYLE_MARKS) if (attrs[m]) styles[m] = true;
    const run: DocText = { type: 'text', text: op.insert, styles };
    const link = attrs.link as { href?: unknown } | undefined;
    if (link && typeof link.href === 'string') {
      const last = out[out.length - 1];
      if (last && last.type === 'link' && last.href === link.href) last.content.push(run);
      else out.push({ type: 'link', href: link.href, content: [run] });
    } else out.push(run);
  }
  return out;
}

function textChild(el: Y.XmlElement): Y.XmlText | null {
  for (const c of el.toArray()) if (c instanceof Y.XmlText) return c;
  return null;
}

function propsOf(el: Y.XmlElement): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(el.getAttributes() as Record<string, unknown>))
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  return out;
}

function tableOf(el: Y.XmlElement): DocTableContent {
  const rows: DocTableContent['rows'] = [];
  for (const row of el.toArray()) {
    if (!(row instanceof Y.XmlElement) || row.nodeName !== 'tableRow') continue;
    const cells: DocTableCell[] = [];
    for (const cell of row.toArray()) {
      if (!(cell instanceof Y.XmlElement)) continue;
      const para = cell.toArray().find((c): c is Y.XmlElement => c instanceof Y.XmlElement);
      const text = para ? textChild(para) : null;
      cells.push({ type: 'tableCell', content: text ? inlineOf(text) : [], props: propsOf(cell) });
    }
    rows.push({ cells });
  }
  return { type: 'tableContent', rows };
}

function blocksOfGroup(group: Y.XmlElement, depth: number): DocBlock[] {
  const out: DocBlock[] = [];
  if (depth > MAX_DEPTH) return out;
  for (const container of group.toArray()) {
    if (!(container instanceof Y.XmlElement) || container.nodeName !== 'blockContainer') continue;
    const id = container.getAttribute('id');
    let block: DocBlock | null = null;
    let children: DocBlock[] = [];
    for (const part of container.toArray()) {
      if (!(part instanceof Y.XmlElement)) continue;
      if (part.nodeName === 'blockGroup') children = blocksOfGroup(part, depth + 1);
      else if (!block) {
        block = { type: part.nodeName, props: propsOf(part) };
        if (part.nodeName === 'table') block.content = tableOf(part);
        else {
          const text = textChild(part);
          if (text) block.content = inlineOf(text);
        }
      }
    }
    if (!block) continue;
    if (typeof id === 'string' && id) block.id = id;
    if (children.length) block.children = children;
    out.push(block);
  }
  return out;
}

/** The document as plain blocks (empty when there is none). */
export function readDocBlocks(doc: Y.Doc): DocBlock[] {
  if (!doc.share.has(DOC_FRAGMENT)) return [];
  const root = doc.getXmlFragment(DOC_FRAGMENT);
  const group = root.toArray().find((c): c is Y.XmlElement => c instanceof Y.XmlElement && c.nodeName === 'blockGroup');
  return group ? blocksOfGroup(group, 0) : [];
}

// ---- writing ----

function textNode(content: DocInline[] | undefined): Y.XmlText {
  const text = new Y.XmlText();
  const ops: Array<{ insert: string; attributes?: Record<string, unknown> }> = [];
  for (const n of content ?? []) {
    if (!n || typeof n !== 'object') continue;
    const runs: Array<{ run: DocText; href?: string }> =
      n.type === 'link' ? (n.content ?? []).filter((r) => r && r.type === 'text').map((run) => ({ run, href: n.href })) : n.type === 'text' ? [{ run: n }] : [];
    for (const { run, href } of runs) {
      if (typeof run.text !== 'string' || !run.text) continue;
      const attributes: Record<string, unknown> = {};
      for (const m of STYLE_MARKS) if (run.styles?.[m]) attributes[m] = {};
      if (href) attributes.link = { href };
      ops.push(Object.keys(attributes).length ? { insert: run.text, attributes } : { insert: run.text });
    }
  }
  if (ops.length) text.applyDelta(ops);
  return text;
}

const cellContent = (c: DocTableCell): DocInline[] => (Array.isArray(c) ? c : Array.isArray(c?.content) ? c.content : []);

function tableNode(content: DocTableContent): Y.XmlElement {
  const table = new Y.XmlElement('table');
  const rows = (content.rows ?? []).map((r) => r.cells ?? []);
  const width = Math.max(1, ...rows.map((r) => r.length));
  table.insert(
    0,
    rows.map((cells) => {
      const row = new Y.XmlElement('tableRow');
      row.insert(
        0,
        Array.from({ length: width }, (_, i) => {
          const cell = new Y.XmlElement('tableCell');
          const para = new Y.XmlElement('tableParagraph');
          para.insert(0, [textNode(cells[i] ? cellContent(cells[i]) : [])]);
          cell.insert(0, [para]);
          return cell;
        }),
      );
      return row;
    }),
  );
  return table;
}

function containerNode(b: DocBlock, newId: () => string, depth: number): Y.XmlElement {
  const container = new Y.XmlElement('blockContainer');
  container.setAttribute('id', typeof b.id === 'string' && b.id ? b.id : newId());
  const node = b.type === 'table' && b.content && !Array.isArray(b.content) ? tableNode(b.content as DocTableContent) : new Y.XmlElement(b.type);
  for (const [k, v] of Object.entries(b.props ?? {})) if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') node.setAttribute(k, v as string);
  // Blocks without inline content (images, dividers, board embeds) have no text node.
  if (b.type !== 'table' && !['image', 'divider', 'boardEmbed'].includes(b.type)) node.insert(0, [textNode(Array.isArray(b.content) ? b.content : [])]);
  const parts: Y.XmlElement[] = [node];
  if (b.children?.length && depth < MAX_DEPTH) parts.push(groupNode(b.children, newId, depth + 1));
  container.insert(0, parts);
  return container;
}

function groupNode(blocks: DocBlock[], newId: () => string, depth: number): Y.XmlElement {
  const group = new Y.XmlElement('blockGroup');
  group.insert(0, blocks.map((b) => containerNode(b, newId, depth)));
  return group;
}

/**
 * Appends `blocks` to the end of the document (in the caller's transaction, if any), creating its
 * root group when the doc is empty. An empty trailing paragraph (the editor's placeholder line) is
 * replaced rather than kept above the new content.
 */
export function writeDocBlocks(doc: Y.Doc, blocks: DocBlock[], newId: () => string): void {
  if (!blocks.length) return;
  const root = doc.getXmlFragment(DOC_FRAGMENT);
  doc.transact(() => {
    let group = root.toArray().find((c): c is Y.XmlElement => c instanceof Y.XmlElement && c.nodeName === 'blockGroup');
    if (!group) {
      group = new Y.XmlElement('blockGroup');
      root.insert(root.length, [group]);
    }
    const last = group.length ? group.get(group.length - 1) : null;
    if (last instanceof Y.XmlElement && last.length === 1) {
      const only = last.get(0);
      if (only instanceof Y.XmlElement && only.nodeName === 'paragraph' && (textChild(only)?.length ?? 0) === 0) group.delete(group.length - 1, 1);
    }
    group.insert(
      group.length,
      blocks.map((b) => containerNode(b, newId, 0)),
    );
  });
}

/** A fresh document state holding `blocks` (a new doc's first content). */
export function docStateFrom(blocks: DocBlock[], newId: () => string): Uint8Array {
  const doc = new Y.Doc();
  try {
    writeDocBlocks(doc, blocks, newId);
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}
