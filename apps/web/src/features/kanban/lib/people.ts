// Who a person field can name in the kanban's table and focus mode: the board's members
// (Host.listMembers, loaded once per board session) and whoever is connected, you first. Names
// come from here too, so a cell reads a person by their current name. (The card feature keeps its
// own directory for its assignee picker; features don't share modules.)
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Editor, HostUser } from '@engine';

export interface Person {
  id: string;
  name: string;
}

interface Directory {
  members: HostUser[];
  loaded: boolean;
  listeners: Set<() => void>;
}

const directories = new WeakMap<Editor, Directory>();

function directory(editor: Editor): Directory {
  let d = directories.get(editor);
  if (!d) {
    const dir: Directory = { members: [], loaded: false, listeners: new Set() };
    d = dir;
    directories.set(editor, dir);
    editor.host.listMembers().then(
      (members) => {
        dir.members = members;
        dir.loaded = true;
        for (const l of [...dir.listeners]) l();
      },
      () => undefined, // offline / no access: whoever is connected still resolves
    );
  }
  return d;
}

function peopleOf(editor: Editor): Person[] {
  const byId = new Map<string, Person>();
  for (const m of directory(editor).members) byId.set(m.id, { id: m.id, name: m.name });
  for (const p of editor.getPeers()) if (p.user) byId.set(p.user.id, { id: p.user.id, name: p.user.name });
  byId.delete(editor.user.id);
  return [{ id: editor.user.id, name: editor.user.name }, ...[...byId.values()].sort((a, b) => a.name.localeCompare(b.name))];
}

/** Everyone a person field can name, you first; re-renders as the directory loads and people come and go. */
export function useKanbanPeople(editor: Editor): Person[] {
  const cache = useRef<{ key: string; value: Person[] }>({ key: '', value: [] });
  const subscribe = useCallback(
    (cb: () => void) => {
      const d = directory(editor);
      d.listeners.add(cb);
      const off = editor.on('presence', cb);
      return () => {
        d.listeners.delete(cb);
        off();
      };
    },
    [editor],
  );
  const get = useCallback(() => {
    const list = peopleOf(editor);
    const key = list.map((p) => `${p.id}|${p.name}`).join(',');
    if (key !== cache.current.key) cache.current = { key, value: list };
    return cache.current.value;
  }, [editor]);
  useEffect(() => void directory(editor), [editor]);
  return useSyncExternalStore(subscribe, get, get);
}
