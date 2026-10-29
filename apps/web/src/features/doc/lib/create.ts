// Making docs from the board (KAI-124): a new doc object next to this board (its workspace and
// project when the person may create there), shown on the board as a live doc item.
import type { Editor, Point } from '@engine';
import { setEditingDoc } from './state';

const W = 560;
const H = 640;

/** Is this file Markdown? (by type or name: browsers often send .md as text/plain or nothing) */
export function isMarkdownFile(f: File): boolean {
  return f.type === 'text/markdown' || f.type === 'text/x-markdown' || /\.(md|markdown)$/i.test(f.name);
}

/**
 * Pasted text that reads as a Markdown DOCUMENT (not a list for stickies, not one heading for a
 * text box): a heading line plus at least one more block.
 */
export function looksLikeMarkdownDoc(text: string): boolean {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return false;
  return lines.some((l) => /^#{1,6}\s+\S/.test(l));
}

/** Creates the doc on the server (from Markdown), then its item on the board; editing it starts at once when empty. */
export async function createDocFrom(editor: Editor, input: { title?: string; markdown?: string }, at: Point | null): Promise<void> {
  const docs = editor.host.docs;
  if (!docs) return;
  try {
    const doc = await docs.create(input);
    const spot = at ? { x: Math.round(at.x - W / 2), y: Math.round(at.y - H / 2) } : editor.findFreeSpot({ w: W, h: H });
    const id = editor.create<'doc'>({ type: 'doc', uri: `freero://doc/${doc.id}`, x: spot.x, y: spot.y, w: W, h: H }, { select: true });
    if (id && !input.markdown) setEditingDoc(id);
    if (input.markdown) editor.host.notify(`Made the doc “${doc.title}” from Markdown`, 'success');
  } catch (err) {
    editor.host.notify(err instanceof Error ? err.message : 'Could not create the doc', 'error');
  }
}
