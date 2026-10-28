// A board's content as SAVED (the stored base + update log), as every reader of the board sees it:
// the shared doc only — no layer — with a viewer's rules (nothing under a hidden frame). For
// derived indexes (references), which run from the outbox on whichever instance holds the
// consumer, and must not load a live room or depend on what one instance happens to hold.
import * as Y from 'yjs';
import { loadDoc } from './docStore';
import { viewOf, type BoardView } from './view';

/** Null when nothing was ever saved for the board. */
export async function storedBoardView(boardId: string): Promise<BoardView | null> {
  const stored = await loadDoc(boardId);
  if (!stored.state) return null;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, stored.state);
    const view = viewOf(doc, new Map(), { userId: '', role: 'viewer' });
    // Copied out: the doc is destroyed before anyone reads the result.
    const collections = new Map<string, ReadonlyMap<string, unknown>>();
    for (const name of doc.share.keys()) collections.set(name, new Map(view.collection(name)));
    return { ...view, collection: (name) => collections.get(name) ?? new Map() };
  } finally {
    doc.destroy();
  }
}
