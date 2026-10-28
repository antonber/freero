// Who's who in comments: current profiles (name, photo) for author and @mention ids. Looked up
// through the Host — which also knows people who wrote here and then left the board — and
// refreshed from presence, so a renamed or re-photographed collaborator shows up as they are now.
// Ids the server doesn't return (deleted accounts) stay unknown: initials / "@someone".
import { useEffect, useMemo, useState } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import { mentionedUserIds } from '@freero/shared';
import type { Editor, HostUser } from '@engine';

interface Directory {
  people: StoreApi<Record<string, HostUser>>;
  /** Ids asked for (or being asked for): never looked up twice. */
  requested: Set<string>;
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  members: Promise<HostUser[]> | null;
}

const directories = new WeakMap<Editor, Directory>();

function directory(editor: Editor): Directory {
  let d = directories.get(editor);
  if (!d) {
    const dir: Directory = { people: createStore(() => ({ [editor.user.id]: editor.user })), requested: new Set([editor.user.id]), pending: new Set(), timer: null, members: null };
    // Presence carries everyone online's current profile (the server fills it in).
    editor.on('presence', () => remember(dir, editor.getPeers().map((p) => ({ ...p.user, avatarUrl: p.user.avatarUrl ?? null }))));
    directories.set(editor, (d = dir));
  }
  return d;
}

function remember(d: Directory, users: HostUser[]): void {
  const cur = d.people.getState();
  const changed = users.filter((u) => {
    const c = cur[u.id];
    return !c || c.name !== u.name || c.color !== u.color || c.avatarUrl !== u.avatarUrl;
  });
  if (changed.length) d.people.setState(Object.fromEntries(changed.map((u) => [u.id, u])));
}

/** Asks the Host for the ids not known yet (batched over one tick). */
function request(editor: Editor, ids: Iterable<string>): void {
  const d = directory(editor);
  for (const id of ids) if (id && !d.requested.has(id)) (d.requested.add(id), d.pending.add(id));
  if (!d.pending.size || d.timer) return;
  d.timer = setTimeout(() => {
    d.timer = null;
    const batch = [...d.pending];
    d.pending.clear();
    editor.host.lookupUsers(batch).then(
      (users) => remember(d, users),
      () => batch.forEach((id) => d.requested.delete(id)), // try again next time they render
    );
  }, 0);
}

/** id -> profile for these ids (and whatever is known already); unknown ids are looked up. */
export function usePeople(editor: Editor, ids: string[]): Record<string, HostUser> {
  const d = directory(editor);
  const key = ids.join(',');
  useEffect(() => request(editor, key ? key.split(',') : []), [editor, key]);
  return useStore(d.people);
}

/** Everyone with access to the board, for the @mention picker (loaded once per board session). */
export function useMembers(editor: Editor, enabled: boolean): HostUser[] | null {
  const d = directory(editor);
  const [members, setMembers] = useState<HostUser[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    d.members ??= editor.host.listMembers().then((m) => (remember(d, m), m));
    d.members.then(
      (m) => live && setMembers(m),
      () => {
        d.members = null;
        if (live) setMembers([]);
      },
    );
    return () => {
      live = false;
    };
  }, [editor, d, enabled]);
  return members;
}

/** A member who joined just now (invited from the picker): the next picker includes them. */
export function addMember(editor: Editor, user: HostUser): void {
  const d = directory(editor);
  remember(d, [user]);
  if (d.members) d.members = d.members.then((m) => (m.some((x) => x.id === user.id) ? m : [...m, user]));
}

/** Profiles for the authors and @mentioned people of these messages. */
export function usePeopleOf(editor: Editor, messages: Array<{ authorId: string; text: string }>): Record<string, HostUser> {
  const ids = useMemo(() => {
    const out = new Set<string>();
    for (const m of messages) {
      out.add(m.authorId);
      for (const id of mentionedUserIds(m.text)) out.add(id);
    }
    return [...out].sort();
  }, [messages]);
  return usePeople(editor, ids);
}
