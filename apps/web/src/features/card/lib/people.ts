// Resolving a card's assigneeId to a name + color. Cards store only the user id; names come
// from the current user and connected peers (presence). People seen before are remembered in
// localStorage so an assignee who isn't online still shows their initials.
// (A Host member directory would make this exact for never-seen members; see report.)
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useEditor, type Editor } from '@engine';

export interface Person {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
  online: boolean;
}

const KEY = 'freero:card-people';
let directory: Record<string, { name: string; color: string }> | null = null;

function dir() {
  if (directory) return directory;
  try {
    directory = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    directory = {};
  }
  return directory!;
}

function remember(people: Person[]) {
  const d = dir();
  let changed = false;
  for (const p of people) {
    const cur = d[p.id];
    if (!cur || cur.name !== p.name || cur.color !== p.color) {
      d[p.id] = { name: p.name, color: p.color };
      changed = true;
    }
  }
  if (!changed) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // storage full / disabled: names still resolve while people are online
  }
}

/** You first, then everyone connected (one entry per user). */
export function onlinePeople(editor: Editor): Person[] {
  const me = editor.user;
  const out: Person[] = [{ id: me.id, name: me.name, color: me.color, avatarUrl: me.avatarUrl, online: true }];
  const seen = new Set([me.id]);
  for (const p of editor.getPeers()) {
    if (!p.user || seen.has(p.user.id)) continue;
    seen.add(p.user.id);
    out.push({ id: p.user.id, name: p.user.name, color: p.user.color, avatarUrl: p.user.avatarUrl, online: true });
  }
  remember(out);
  return out;
}

export function resolvePerson(editor: Editor, id: string): Person | null {
  const online = onlinePeople(editor).find((p) => p.id === id);
  if (online) return online;
  const known = dir()[id];
  return known ? { id, ...known, online: false } : null;
}

/** Re-renders only when this person's resolved name/color changes (not on every cursor move). */
export function usePerson(id: string | null | undefined): Person | null {
  const editor = useEditor();
  const cache = useRef<{ key: string; value: Person | null }>({ key: '', value: null });
  const subscribe = useCallback((cb: () => void) => editor.on('presence', cb), [editor]);
  const get = useCallback(() => {
    const p = id ? resolvePerson(editor, id) : null;
    const key = p ? `${p.id}|${p.name}|${p.color}|${p.avatarUrl ?? ''}` : '';
    if (key !== cache.current.key) cache.current = { key, value: p };
    return cache.current.value;
  }, [editor, id]);
  return useSyncExternalStore(subscribe, get);
}
