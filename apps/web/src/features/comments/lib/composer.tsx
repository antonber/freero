// Comment text boxes with @mentions: an "@" opens a list of the board's members; picking one
// writes "@Name" (stored as the person's id when sent, see mentions.ts). Owners and editors can
// type an email address after "@" to invite someone who isn't on the board yet, as a commenter.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MailPlus } from 'lucide-react';
import type { Editor, HostUser } from '@engine';
import { Avatar, Spinner } from '@ui';
import { isEmailQuery, matchMembers, mentionQuery, segments, type MentionPick } from './mentions';
import { addMember, useMembers } from './people';

/** Enter sends (like every chat and comment box); Shift+Enter is a new line. IME composition never sends. */
const isSend = (e: KeyboardEvent) => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing;

type Option = { kind: 'member'; user: HostUser } | { kind: 'invite'; email: string };

export interface MentionTextProps {
  editor: Editor;
  value: string;
  onChange: (v: string) => void;
  picks: MentionPick[];
  onPicks: (p: MentionPick[]) => void;
  onSubmit: () => void;
  placeholder: string;
  autoFocus?: boolean;
  label: string;
  /** Handles Escape here (e.g. cancel an edit) instead of letting it close the popover. */
  onEscape?: () => void;
}

/** Grows with its content up to a cap. */
export function MentionText(props: MentionTextProps) {
  const { editor, value, onChange, picks, onPicks } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  /** "@" position whose list was dismissed with Escape (typing another "@" opens a new one). */
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [inviting, setInviting] = useState(false);
  const pendingCaret = useRef<number | null>(null);

  const query = caret === null ? null : mentionQuery(value, caret);
  const open = !!query && dismissed !== query.start;
  const members = useMembers(editor, open);
  const canInvite = editor.can('editor');
  const options: Option[] = [];
  if (open && query) {
    for (const user of matchMembers((members ?? []).filter((m) => m.id !== editor.user.id), query.query)) options.push({ kind: 'member', user });
    if (canInvite && isEmailQuery(query.query) && !options.length) options.push({ kind: 'invite', email: query.query.trim() });
  }
  const showList = open && (options.length > 0 || members === null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [value]);
  // Focused while mounting (the Popover keeps it), caret at the end of any existing text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!props.autoFocus || !el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autoFocus]);
  // After inserting a mention, put the caret right behind it.
  useLayoutEffect(() => {
    const el = ref.current;
    const at = pendingCaret.current;
    if (!el || at === null) return;
    pendingCaret.current = null;
    el.focus({ preventScroll: true });
    el.setSelectionRange(at, at);
    setCaret(at);
  }, [value]);
  useEffect(() => setActive(0), [query?.start, query?.query]);

  const syncCaret = () => setCaret(ref.current?.selectionStart ?? null);

  const insert = (text: string, pick?: MentionPick) => {
    if (!query || caret === null) return;
    const next = value.slice(0, query.start) + text + value.slice(caret);
    pendingCaret.current = query.start + text.length;
    if (pick && !picks.some((p) => p.id === pick.id && p.name === pick.name)) onPicks([...picks, pick]);
    onChange(next);
  };

  const choose = (o: Option) => {
    if (o.kind === 'member') return insert(`@${o.user.name} `, { id: o.user.id, name: o.user.name });
    if (inviting) return;
    setInviting(true);
    editor.host
      .inviteMember(o.email, 'commenter')
      .then((r) => {
        if ('user' in r) {
          addMember(editor, r.user);
          insert(`@${r.user.name} `, { id: r.user.id, name: r.user.name });
          editor.host.notify(`${r.user.name} can open this board and will be notified of the mention.`, 'success');
        } else {
          insert(`${r.pendingEmail} `);
          editor.host.notify(`Invite sent to ${r.pendingEmail}. Mention them once they've joined.`, 'success');
        }
      })
      .catch((err: unknown) => editor.host.notify(err instanceof Error && err.message ? err.message : 'Could not send the invite', 'error'))
      .finally(() => setInviting(false));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showList && options.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + step + options.length) % options.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) || e.key === 'Tab') {
        e.preventDefault();
        choose(options[Math.min(active, options.length - 1)]);
        return;
      }
    }
    if (showList && e.key === 'Escape') {
      e.preventDefault(); // the popover stays open (escapeToContent)
      setDismissed(query!.start);
      return;
    }
    if (isSend(e)) {
      e.preventDefault();
      props.onSubmit();
    } else if (e.key === 'Escape' && props.onEscape) {
      e.preventDefault();
      props.onEscape();
    }
  };

  return (
    <div className="fr-cm-mentionbox">
      {showList && (
        <div className="fr-cm-mentions" role="listbox" id={listId} aria-label="Mention someone">
          {members === null ? (
            <div className="fr-cm-mentions__empty">
              <Spinner size={16} />
            </div>
          ) : (
            options.map((o, i) => (
              <div
                key={o.kind === 'member' ? o.user.id : `invite:${o.email}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`fr-cm-mentions__item${i === active ? ' is-active' : ''}`}
                // Keep the focus (and caret) in the text box.
                onPointerDown={(e) => e.preventDefault()}
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                {o.kind === 'member' ? (
                  <>
                    <Avatar name={o.user.name} color={o.user.color} src={o.user.avatarUrl} size={22} />
                    <span className="fr-cm-mentions__name">{o.user.name}</span>
                  </>
                ) : (
                  <>
                    <span className="fr-cm-mentions__icon">{inviting ? <Spinner size={14} /> : <MailPlus size={14} />}</span>
                    <span className="fr-cm-mentions__name">
                      Invite <strong>{o.email}</strong> to comment
                    </span>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
      <textarea
        ref={ref}
        className="fr-cm-input"
        rows={1}
        value={value}
        placeholder={props.placeholder}
        aria-label={props.label}
        aria-autocomplete="list"
        aria-controls={showList ? listId : undefined}
        aria-activedescendant={showList && options.length ? `${listId}-${Math.min(active, options.length - 1)}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onSelect={syncCaret}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onFocus={syncCaret}
        onBlur={() => setCaret(null)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

/** Stored comment text with mentions shown as the people's current names. */
export function MessageText({ text, people, meId }: { text: string; people: Record<string, HostUser>; meId: string }) {
  return (
    <>
      {segments(text).map((s, i) =>
        s.kind === 'text' ? (
          s.text
        ) : (
          <span key={i} className={`fr-cm-mention${s.userId === meId ? ' is-me' : ''}`}>
            @{people[s.userId]?.name ?? 'someone'}
          </span>
        ),
      )}
    </>
  );
}
