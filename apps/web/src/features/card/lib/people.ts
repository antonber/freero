// Who can be assigned, and resolving a card's assigneeId to a name + color. Cards store only
// the user id. The board's member directory (Host.listMembers) knows everyone with access,
// including people who have never been online here; presence adds who is connected right now
// (fresher names/colors, and people on the board who aren't listed members).
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useEditor, type Editor, type HostUser } from '@engine';

export interface Person {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
  online: boolean;
}

interface Directory {
  members: HostUser[];
  pending: Promise<void> | null;
  listeners: Set<() => void>;
}

// Per board session (the scoped editor lives exactly as long as the session).
const directories = new WeakMap<Editor, Directory>();

function directory(editor: Editor): Directory {
  let d = directories.get(editor);
  if (!d) {
    d = { members: [], pending: null, listeners: new Set() };
    directories.set(editor, d);
    void refreshMembers(editor);
  }
  return d;
}

/** (Re)loads the member directory, e.g. when the assignee picker opens. Never rejects. */
export function refreshMembers(editor: Editor): Promise<void> {
  const d = directory(editor);
  if (d.pending) return d.pending;
  d.pending = editor.host
    .listMembers()
    .then(
      (members) => {
        d.members = members;
      },
      () => undefined, // offline / no access: presence still resolves whoever is here
    )
    .finally(() => {
      d.pending = null;
      for (const l of [...d.listeners]) l();
    });
  return d.pending;
}

/** You first, then members and connected people (online first, then by name). */
export function boardPeople(editor: Editor): Person[] {
  const me = editor.user;
  const byId = new Map<string, Person>();
  for (const m of directory(editor).members) byId.set(m.id, { ...m, online: false });
  for (const p of editor.getPeers()) if (p.user) byId.set(p.user.id, { ...p.user, online: true });
  byId.delete(me.id);
  const others = [...byId.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return [{ id: me.id, name: me.name, color: me.color, avatarUrl: me.avatarUrl, online: true }, ...others];
}

export function resolvePerson(editor: Editor, id: string): Person | null {
  return boardPeople(editor).find((p) => p.id === id) ?? null;
}

function subscribe(editor: Editor, cb: () => void): () => void {
  const d = directory(editor);
  d.listeners.add(cb);
  const off = editor.on('presence', cb);
  return () => {
    d.listeners.delete(cb);
    off();
  };
}

/** Everyone assignable; re-renders as people come and go or the directory loads. */
export function useBoardPeople(editor: Editor, open: boolean): Person[] {
  useEffect(() => {
    if (open) void refreshMembers(editor);
  }, [editor, open]);
  const cache = useRef<{ key: string; value: Person[] }>({ key: '', value: [] });
  const get = useCallback(() => {
    const list = boardPeople(editor);
    const key = list.map((p) => `${p.id}|${p.name}|${p.color}|${p.avatarUrl ?? ''}|${p.online}`).join(',');
    if (key !== cache.current.key) cache.current = { key, value: list };
    return cache.current.value;
  }, [editor]);
  return useSyncExternalStore(useCallback((cb) => subscribe(editor, cb), [editor]), get);
}

/** Re-renders only when this person's resolved name/color changes (not on every cursor move). */
export function usePerson(id: string | null | undefined): Person | null {
  const editor = useEditor();
  const cache = useRef<{ key: string; value: Person | null }>({ key: '', value: null });
  const get = useCallback(() => {
    const p = id ? resolvePerson(editor, id) : null;
    const key = p ? `${p.id}|${p.name}|${p.color}|${p.avatarUrl ?? ''}` : '';
    if (key !== cache.current.key) cache.current = { key, value: p };
    return cache.current.value;
  }, [editor, id]);
  return useSyncExternalStore(useCallback((cb) => subscribe(editor, cb), [editor]), get);
}
