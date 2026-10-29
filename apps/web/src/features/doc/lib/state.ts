// Local state of the doc items on this board (never synced): which one THIS client is editing in
// place, and what the server said about each doc's address for this viewer (title, access), asked
// once per address and view of the board.
import type { Editor } from '@engine';
import type { ResolvedObject } from '@freero/shared';

let editingId: string | null = null;
const listeners = new Set<() => void>();

export const getEditingDoc = (): string | null => editingId;

export function setEditingDoc(id: string | null): void {
  if (editingId === id) return;
  editingId = id;
  listeners.forEach((l) => l());
}

export function subscribeEditingDoc(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const resolved = new Map<string, Promise<ResolvedObject>>();

/** The doc's summary for this viewer (title, access) — or unavailable, the same for "no access" and "gone". */
export function resolveDoc(editor: Editor, uri: string): Promise<ResolvedObject> {
  let p = resolved.get(uri);
  if (!p) {
    p = (editor.host.resolveObjects ? editor.host.resolveObjects([uri]) : Promise.resolve([] as ResolvedObject[])).then(
      (out) => out[0] ?? { uri, status: 'unavailable' as const },
      () => {
        resolved.delete(uri);
        return { uri, status: 'unavailable' as const };
      },
    );
    resolved.set(uri, p);
    // A rename or a new share shows on the next view: answers are kept for a moment only.
    setTimeout(() => resolved.delete(uri), 15_000);
  }
  return p;
}

/** The doc id in a doc address, or null. */
export function docIdOf(uri: string): string | null {
  const m = /^freero:\/\/doc\/([A-Za-z0-9_-]{1,64})$/.exec(uri.trim());
  return m ? m[1] : null;
}
