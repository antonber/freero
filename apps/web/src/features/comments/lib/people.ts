// Who's who in comments: current profiles (name, photo) for author and @mention ids come from the
// engine's people directory (usePeople: presence + Host.lookupUsers, shared with find), so a
// renamed or re-photographed collaborator shows up as they are now. Ids the server doesn't return
// (deleted accounts) stay unknown: initials / "@someone".
import { useEffect, useMemo, useState } from 'react';
import { commentAuthorName, mentionedUserIds } from '@freero/shared';
import { usePeople, type Editor, type HostUser } from '@engine';

/** The board's member list for the @mention picker, loaded once per board session. */
const memberLists = new WeakMap<Editor['host'], Promise<HostUser[]>>();

/** Everyone with access to the board, for the @mention picker (loaded once per board session). */
export function useMembers(editor: Editor, enabled: boolean): HostUser[] | null {
  const [members, setMembers] = useState<HostUser[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let list = memberLists.get(editor.host);
    if (!list) memberLists.set(editor.host, (list = editor.host.listMembers()));
    list.then(
      (m) => live && setMembers(m),
      () => {
        memberLists.delete(editor.host);
        if (live) setMembers([]);
      },
    );
    return () => {
      live = false;
    };
  }, [editor, enabled]);
  return members;
}

/** A member who joined just now (invited from the picker): the next picker includes them. */
export function addMember(editor: Editor, user: HostUser): void {
  const list = memberLists.get(editor.host);
  if (list) memberLists.set(editor.host, list.then((m) => (m.some((x) => x.id === user.id) ? m : [...m, user])));
}

/** The name a message is shown under: its author's current name when known (`commentAuthorName`). */
export function authorName(m: { authorId: string; authorName: string }, people: Record<string, HostUser>): string {
  return commentAuthorName(m, people[m.authorId]?.name);
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
  return usePeople(ids);
}
