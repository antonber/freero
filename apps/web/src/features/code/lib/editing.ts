// Which code block THIS client is editing (local UI state, never synced). Code is edited in a plain
// <textarea> inside the block, not in the engine's rich-text editor: code is plain text.
let editingId: string | null = null;
const listeners = new Set<() => void>();

export const getEditingCode = (): string | null => editingId;

export function setEditingCode(id: string | null): void {
  if (editingId === id) return;
  editingId = id;
  listeners.forEach((l) => l());
}

export function subscribeEditingCode(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
