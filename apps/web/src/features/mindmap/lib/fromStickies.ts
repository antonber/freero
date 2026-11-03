// "Make a mind map" (#134): selected sticky notes become one map — the chosen note is the central
// topic, the others its first-level ideas (top to bottom, left to right as they lay) — where the
// central note was. The notes are replaced by the map in ONE transaction: one undo puts them back.
import { nanoid } from 'nanoid';
import { layoutStructure, richTextToPlain, type BoardElement, type StickyElement } from '@freero/shared';
import type { Editor } from '@engine';
import { relayout, rootIdsOf } from './actions';

/** The stickies of `ids` a map can be made of (unlocked ones). */
export function stickiesOf(editor: Editor, ids: string[]): StickyElement[] {
  return ids.map((id) => editor.getElement(id)).filter((el): el is StickyElement => el?.type === 'sticky' && !el.locked);
}

const textOf = (el: StickyElement) => richTextToPlain(el.text).replace(/\s+/g, ' ').trim();

/** Turns the stickies of `ids` into a map around `rootId`; returns the new topics' ids ([] when it can't). */
export function mapFromStickies(editor: Editor, rootId: string, ids: string[]): string[] {
  const notes = stickiesOf(editor, ids);
  const root = notes.find((n) => n.id === rootId);
  if (!root || notes.length < 2 || !editor.mayAdd('mindmap')) return [];
  const others = notes.filter((n) => n.id !== rootId).sort((a, b) => a.y - b.y || a.x - b.x);
  const laid = layoutStructure({ kind: 'mindmap', root: { text: textOf(root) || 'Central topic', children: others.map((n) => ({ text: textOf(n) || 'Idea' })) } }, { newId: nanoid });
  const centre = laid.elements.find((d) => d.type === 'mindmap' && !(d as { parentId?: string | null }).parentId);
  if (!centre) return [];
  // The map's central topic lands where the central note was.
  const xs = laid.elements.map((d) => [d.x, d.x + d.w]).flat();
  const ys = laid.elements.map((d) => [d.y, d.y + d.h]).flat();
  const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const at = { x: root.x + root.w / 2 + (mid.x - (centre.x + centre.w / 2)), y: root.y + root.h / 2 + (mid.y - (centre.y + centre.h / 2)) };
  const now = Date.now();
  let made: string[] = [];
  editor.transact(() => {
    editor.remove(notes.map((n) => n.id));
    made = editor.insertElements(
      { elements: laid.elements.map((d) => ({ ...d, z: 0, createdBy: editor.host.user.id, createdAt: now, updatedAt: now }) as BoardElement) },
      { at },
    );
    // The real font measures pills a little differently from the layout's estimate: tidy once.
    relayout(editor, rootIdsOf(editor, made));
  });
  return made;
}
