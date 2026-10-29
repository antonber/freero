// Comments pinned to moments of a walkthrough. They live with the walkthrough on the server (not in
// the board's comment threads); an @mention is a `<@userId>` token, picked from the board's members,
// and the server notifies exactly those people (if they can open the board).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign, Send, Trash2, X } from 'lucide-react';
import { formatWalkthroughTime, MAX_WALKTHROUGH_COMMENT, mentionedUserIds, mentionsAsNames, mentionToken, type Walkthrough, type WalkthroughComment } from '@freero/shared';
import { usePeople, useRole, type Editor, type HostUser } from '@engine';
import { Avatar, Button, IconButton, Popover, TextArea } from '@ui';

export interface CommentsState {
  list: WalkthroughComment[] | null;
  error: string | null;
  refresh(): void;
}

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong');

/** The walkthrough's comments, read again whenever the board says their number changed. */
export function useWalkthroughComments(editor: Editor, id: string, count: number): CommentsState {
  const [list, setList] = useState<WalkthroughComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let live = true;
    editor.host.walkthroughs?.comments(id).then(
      (c) => live && (setList(c), setError(null)),
      (e: unknown) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [editor, id, count, rev]);
  const refresh = useCallback(() => setRev((r) => r + 1), []);
  return { list, error, refresh };
}

/** "@Ann" for every mention picked in the composer; turned into tokens when sent. */
function toTokens(text: string, picked: HostUser[]): string {
  let out = text;
  for (const u of [...picked].sort((a, b) => b.name.length - a.name.length)) out = out.split(`@${u.name}`).join(mentionToken(u.id));
  return out;
}

export function Comments({
  editor,
  w,
  t,
  state,
  onSeek,
  onClose,
}: {
  editor: Editor;
  w: Walkthrough;
  t: number;
  state: CommentsState;
  onSeek(ms: number): void;
  onClose(): void;
}) {
  const role = useRole();
  const mayComment = role !== 'viewer' && editor.host.board.signedIn !== false;
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<HostUser[]>([]);
  const [sending, setSending] = useState(false);
  const [members, setMembers] = useState<HostUser[] | null>(null);
  const [picking, setPicking] = useState(false);
  const atButton = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const ids = [...new Set((state.list ?? []).flatMap((c) => [...(c.author ? [c.author.id] : []), ...mentionedUserIds(c.text)]))];
  const people = usePeople(ids);
  const nameOf = (id: string) => people[id]?.name;

  useEffect(() => {
    if (picking && !members) editor.host.listMembers().then(setMembers, () => setMembers([]));
  }, [picking, members, editor]);

  const send = async () => {
    const body = toTokens(text.trim(), picked);
    if (!body || !editor.host.walkthroughs) return;
    setSending(true);
    try {
      await editor.host.walkthroughs.comment(w.id, { atMs: Math.round(t), text: body });
      setText('');
      setPicked([]);
      state.refresh();
    } catch (e) {
      editor.host.notify(message(e), 'error');
    } finally {
      setSending(false);
    }
  };

  const remove = async (c: WalkthroughComment) => {
    try {
      await editor.host.walkthroughs?.deleteComment(w.id, c.id);
      state.refresh();
    } catch (e) {
      editor.host.notify(message(e), 'error');
    }
  };

  const pick = (u: HostUser) => {
    setPicked((p) => (p.some((x) => x.id === u.id) ? p : [...p, u]));
    setText((s) => `${s}${s && !s.endsWith(' ') ? ' ' : ''}@${u.name} `);
    setPicking(false);
    box.current?.focus();
  };

  return (
    <section className="fr-walkthrough-comments" aria-label="Comments on this walkthrough" data-fr-occludes="">
      <header className="fr-walkthrough-comments__head">
        <h2>Comments</h2>
        <IconButton icon={X} label="Close comments" onClick={onClose} />
      </header>
      <ol className="fr-walkthrough-comments__list">
        {state.error && <li className="fr-walkthrough-comments__empty" role="alert">{state.error}</li>}
        {state.list && !state.list.length && <li className="fr-walkthrough-comments__empty">No comments yet. Pause where something needs a word and write it here.</li>}
        {state.list?.map((c) => {
          const who = c.author ? (people[c.author.id]?.name ?? c.author.name) : 'Deleted user';
          const mine = c.author?.id === editor.user.id;
          return (
            <li key={c.id} className="fr-walkthrough-comments__item">
              <Avatar name={who} color={(c.author && people[c.author.id]?.color) || '#8a8aa0'} src={(c.author && people[c.author.id]?.avatarUrl) || null} size={24} />
              <div className="fr-walkthrough-comments__body">
                <div className="fr-walkthrough-comments__meta">
                  <strong>{who}</strong>
                  <button type="button" className="fr-walkthrough-comments__at" onClick={() => onSeek(c.atMs)} aria-label={`Go to ${formatWalkthroughTime(c.atMs)}`}>
                    {formatWalkthroughTime(c.atMs)}
                  </button>
                </div>
                <p>{mentionsAsNames(c.text, nameOf)}</p>
              </div>
              {(mine || editor.can('editor')) && <IconButton icon={Trash2} label="Delete comment" size={32} onClick={() => void remove(c)} />}
            </li>
          );
        })}
      </ol>
      {mayComment && (
        <div className="fr-walkthrough-comments__composer">
          <TextArea
            ref={box}
            rows={2}
            value={text}
            maxLength={MAX_WALKTHROUGH_COMMENT}
            placeholder={`Comment at ${formatWalkthroughTime(t)}…`}
            aria-label={`Comment at ${formatWalkthroughTime(t)}`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
            }}
          />
          <div className="fr-walkthrough-comments__actions">
            <IconButton ref={atButton} icon={AtSign} label="Mention someone" onClick={() => setPicking((p) => !p)} />
            <Popover open={picking} anchor={atButton.current} onClose={() => setPicking(false)} side="top">
              <ul className="fr-walkthrough-mentions" role="listbox" aria-label="People on this board">
                {(members ?? []).map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => pick(u)}>
                      <Avatar name={u.name} color={u.color} src={u.avatarUrl} size={20} /> {u.name}
                    </button>
                  </li>
                ))}
                {members && !members.length && <li className="fr-walkthrough-mentions__empty">Nobody to mention yet</li>}
              </ul>
            </Popover>
            <Button size="sm" variant="primary" icon={Send} loading={sending} disabled={!text.trim()} onClick={() => void send()}>
              Comment at {formatWalkthroughTime(t)}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
