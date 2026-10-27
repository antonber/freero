// Thread popover content: messages, reactions, edit/delete, reply box, resolve, and the
// composer for a new thread.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Check, MoreHorizontal, Pencil, RotateCcw, SmilePlus, Trash2, X } from 'lucide-react';
import { usePeers, type Editor } from '@engine';
import { Avatar, Button, IconButton, Menu, Popover, Tooltip, formatShortcut } from '@ui';
import type { CommentMessage, CommentThread } from '@freero/shared';
import { MESSAGE_REACTIONS, colorFor, relativeTime } from './model';
import {
  canDeleteThread,
  deleteMessage,
  deleteThread,
  editMessage,
  reply,
  setResolved,
  setUi,
  submitDraft,
  toggleReaction,
} from './state';

/** Server-clock "now" (comment timestamps are server time), refreshed periodically. */
export function useNow(editor: Editor, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => editor.host.serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(editor.host.serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [editor, intervalMs]);
  return now;
}

const isSend = (e: KeyboardEvent) => e.key === 'Enter' && (e.metaKey || e.ctrlKey);

/** Grows with its content up to a cap. */
function AutoText(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  autoFocus?: boolean;
  label: string;
  /** Handles Escape here (e.g. cancel an edit) instead of letting it close the popover. */
  onEscape?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [props.value]);
  // Focused while mounting (the Popover keeps it), caret at the end of any existing text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!props.autoFocus || !el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [props.autoFocus]);
  return (
    <textarea
      ref={ref}
      className="fr-cm-input"
      rows={1}
      value={props.value}
      placeholder={props.placeholder}
      aria-label={props.label}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (isSend(e)) {
          e.preventDefault();
          props.onSubmit();
        } else if (e.key === 'Escape' && props.onEscape) {
          e.preventDefault();
          props.onEscape();
        }
      }}
    />
  );
}

function SendHint() {
  return <span className="fr-cm-hint">{formatShortcut('mod+enter')} to send</span>;
}

export function authorColor(m: Pick<CommentMessage, 'authorColor' | 'authorId'>): string {
  return m.authorColor ?? colorFor(m.authorId);
}

// ---------------------------------------------------------------------------
// New thread composer
// ---------------------------------------------------------------------------
export function DraftComposer({ editor }: { editor: Editor }) {
  const [text, setText] = useState('');
  const send = () => submitDraft(editor, text);
  return (
    <div className="fr-cm-composer">
      <div className="fr-cm-composer__row">
        <Avatar name={editor.user.name} color={editor.user.color} src={editor.user.avatarUrl} size={28} />
        <AutoText value={text} onChange={setText} onSubmit={send} placeholder="Add a comment…" label="Comment" autoFocus />
      </div>
      <div className="fr-cm-composer__foot">
        <SendHint />
        <Button size="sm" variant="ghost" onClick={() => setUi(editor, { draft: null })}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!text.trim()} onClick={send}>
          Comment
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------
function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton ref={ref} icon={SmilePlus} label="Add reaction" size={32} active={open} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="top" align="end" aria-label="Reactions">
        <div className="fr-cm-picker">
          {MESSAGE_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={`React ${e}`}
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

function MessageRow(props: {
  editor: Editor;
  thread: CommentThread;
  message: CommentMessage;
  canWrite: boolean;
  names: Map<string, string>;
  now: number;
  editing: boolean;
  onEdit: (on: boolean) => void;
}) {
  const { editor, thread, message: m, canWrite, names, now, editing, onEdit } = props;
  const [draft, setDraft] = useState(m.text);
  const mine = m.authorId === editor.user.id;
  const reactions = Object.entries(m.reactions).filter(([, users]) => users.length);
  const save = () => {
    if (draft.trim()) editMessage(editor, thread.id, m.id, draft);
    onEdit(false);
  };
  return (
    <div className={`fr-cm-msg${editing ? ' is-editing' : ''}`}>
      <Avatar name={m.authorName} color={authorColor(m)} size={28} />
      <div className="fr-cm-msg__body">
        <div className="fr-cm-msg__head">
          <span className="fr-cm-msg__name">{m.authorName}</span>
          <Tooltip content={new Date(m.createdAt).toLocaleString()} side="top">
            <span className="fr-cm-msg__time">
              {relativeTime(m.createdAt, now)}
              {m.editedAt ? ' · edited' : ''}
            </span>
          </Tooltip>
          {canWrite && !editing && (
            <span className="fr-cm-msg__tools">
              <ReactionPicker onPick={(e) => toggleReaction(editor, thread.id, m.id, e)} />
              {mine && (
                <>
                  <IconButton
                    icon={Pencil}
                    label="Edit"
                    size={32}
                    onClick={() => {
                      setDraft(m.text);
                      onEdit(true);
                    }}
                  />
                  <IconButton icon={Trash2} label="Delete" size={32} onClick={() => deleteMessage(editor, thread.id, m.id)} />
                </>
              )}
            </span>
          )}
        </div>
        {editing ? (
          <div className="fr-cm-edit">
            <AutoText value={draft} onChange={setDraft} onSubmit={save} onEscape={() => onEdit(false)} placeholder="Edit comment" label="Edit comment" autoFocus />
            <div className="fr-cm-composer__foot">
              <SendHint />
              <Button size="sm" variant="ghost" onClick={() => onEdit(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={!draft.trim()} onClick={save}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="fr-cm-msg__text">{m.text}</div>
        )}
        {reactions.length > 0 && (
          <div className="fr-cm-reactions">
            {reactions.map(([emoji, users]) => {
              const me = users.includes(editor.user.id);
              const who = users.map((u) => (u === editor.user.id ? 'You' : (names.get(u) ?? 'Someone'))).join(', ');
              return (
                <Tooltip key={emoji} content={who} side="top">
                  <button
                    type="button"
                    className={`fr-cm-chip${me ? ' is-mine' : ''}`}
                    disabled={!canWrite}
                    aria-pressed={me}
                    aria-label={`${emoji} ${users.length}`}
                    onClick={() => toggleReaction(editor, thread.id, m.id, emoji)}
                  >
                    <span>{emoji}</span>
                    <span>{users.length}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function ThreadView({
  editor,
  thread,
  elementMissing,
  editingId,
  setEditingId,
}: {
  editor: Editor;
  thread: CommentThread;
  elementMissing: boolean;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
}) {
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const now = useNow(editor);
  const peers = usePeers();
  const canWrite = editor.can('commenter');
  const canDelete = canDeleteThread(editor, thread);
  const names = new Map<string, string>();
  for (const p of peers) names.set(p.user.id, p.user.name);
  for (const m of thread.messages) names.set(m.authorId, m.authorName);

  // Keep the newest message in view as replies arrive.
  const count = thread.messages.length;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const send = () => {
    if (!text.trim()) return;
    reply(editor, thread.id, text);
    setText('');
  };

  return (
    <div className="fr-cm-thread">
      <div className="fr-cm-thread__head">
        <span className="fr-cm-thread__title">
          {thread.resolved ? (
            <span className="fr-cm-badge fr-cm-badge--resolved">
              <Check size={12} /> Resolved
            </span>
          ) : (
            'Comment'
          )}
        </span>
        {canWrite &&
          (thread.resolved ? (
            <IconButton icon={RotateCcw} label="Reopen" size={32} onClick={() => setResolved(editor, thread.id, false)} />
          ) : (
            <IconButton
              icon={Check}
              label="Resolve"
              size={32}
              onClick={() => {
                setResolved(editor, thread.id, true);
                setUi(editor, { openId: null });
              }}
            />
          ))}
        {canDelete && (
          <>
            <IconButton ref={moreRef} icon={MoreHorizontal} label="More" size={32} active={menu} onClick={() => setMenu((o) => !o)} />
            <Menu
              open={menu}
              onClose={() => setMenu(false)}
              anchor={moreRef.current}
              align="end"
              minWidth={180}
              items={[{ id: 'delete', label: 'Delete thread', icon: Trash2, danger: true, onSelect: () => deleteThread(editor, thread.id) }]}
            />
          </>
        )}
        <IconButton icon={X} label="Close" size={32} onClick={() => setUi(editor, { openId: null })} />
      </div>
      {elementMissing && <div className="fr-cm-note">The item this was pinned to was deleted.</div>}
      <div className="fr-cm-thread__list" ref={listRef}>
        {thread.messages.map((m) => (
          <MessageRow
            key={m.id}
            editor={editor}
            thread={thread}
            message={m}
            canWrite={canWrite}
            names={names}
            now={now}
            editing={editingId === m.id}
            onEdit={(on) => setEditingId(on ? m.id : null)}
          />
        ))}
      </div>
      {canWrite && !editingId && (
        <div className="fr-cm-reply">
          <AutoText value={text} onChange={setText} onSubmit={send} placeholder="Reply…" label="Reply" autoFocus />
          <IconButton icon={ArrowUp} label="Send reply" shortcut="Mod+Enter" size={32} variant="solid" disabled={!text.trim()} onClick={send} />
        </div>
      )}
    </div>
  );
}
