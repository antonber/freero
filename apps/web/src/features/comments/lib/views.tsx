// Thread popover content: messages, reactions, edit/delete, reply box, resolve, and the
// composer for a new thread.
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Flag, MoreHorizontal, Pencil, RotateCcw, SmilePlus, Trash2, X } from 'lucide-react';
import type { Editor, HostUser } from '@engine';
import { Avatar, Button, IconButton, Menu, Popover, Tooltip, formatShortcut } from '@ui';
import type { CommentMessage, CommentThread } from '@freero/shared';
import { MentionText, MessageText } from './composer';
import { AttachButton, MessageAttachments, PendingAttachments, useAttachDraft } from './attachments';
import { decodeMentions, encodeMentions, type MentionPick } from './mentions';
import { MESSAGE_REACTIONS, colorFor, relativeTime } from './model';
import { authorName, usePeopleOf } from './people';
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

import { t as tr } from '../messages';
/** Server-clock "now" (comment timestamps are server time), refreshed periodically. */
export function useNow(editor: Editor, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => editor.host.serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(editor.host.serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [editor, intervalMs]);
  return now;
}

/** Composer text + the people picked from the @ list (turned into mention tokens on send). */
function useMentionDraft(initial = '') {
  const [text, setText] = useState(initial);
  const [picks, setPicks] = useState<MentionPick[]>([]);
  return {
    text,
    setText,
    picks,
    setPicks,
    /** What to store. */
    encoded: () => encodeMentions(text, picks),
    load(stored: string, nameOf: (id: string) => string | undefined) {
      const d = decodeMentions(stored, nameOf);
      setText(d.text);
      setPicks(d.picks);
    },
    clear() {
      setText('');
      setPicks([]);
    },
  };
}

function SendHint() {
  return (
    <span className="fr-cm-hint" title={tr('valueForANewLine', { value: formatShortcut('shift+enter') })}>{tr('enterToSend')}</span>
  );
}

export function authorColor(m: Pick<CommentMessage, 'authorColor' | 'authorId'>): string {
  return m.authorColor ?? colorFor(m.authorId);
}

// ---------------------------------------------------------------------------
// New thread composer
// ---------------------------------------------------------------------------
export function DraftComposer({ editor }: { editor: Editor }) {
  const d = useMentionDraft();
  const files = useAttachDraft(editor);
  const ready = (!!d.text.trim() || files.items.length > 0) && !files.uploading;
  const send = () => {
    if (ready) submitDraft(editor, d.encoded(), files.items);
  };
  return (
    <div className="fr-cm-composer">
      <div className="fr-cm-composer__row">
        <Avatar name={editor.user.name} color={editor.user.color} src={editor.user.avatarUrl} size={28} />
        <MentionText
          editor={editor}
          value={d.text}
          onChange={d.setText}
          picks={d.picks}
          onPicks={d.setPicks}
          onSubmit={send}
          placeholder={tr('addACommentToMention')}
          label={tr('comment')}
          autoFocus
        />
      </div>
      <PendingAttachments draft={files} />
      <div className="fr-cm-composer__foot">
        <AttachButton draft={files} />
        <SendHint />
        <Button size="sm" variant="ghost" onClick={() => setUi(editor, { draft: null })}>{tr('cancel')}</Button>
        <Button size="sm" variant="primary" disabled={!ready} onClick={send}>{tr('comment')}</Button>
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
      <IconButton ref={ref} icon={SmilePlus} label={tr('addReaction')} size={32} active={open} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="top" align="end" aria-label={tr('reactions')}>
        <div className="fr-cm-picker">
          {MESSAGE_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={tr('reactE', { e })}
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
  people: Record<string, HostUser>;
  now: number;
  editing: boolean;
  onEdit: (on: boolean) => void;
}) {
  const { editor, thread, message: m, canWrite, names, people, now, editing, onEdit } = props;
  const draft = useMentionDraft(m.text);
  const mine = m.authorId === editor.user.id;
  const reactions = Object.entries(m.reactions).filter(([, users]) => users.length);
  const save = () => {
    if (draft.text.trim()) editMessage(editor, thread.id, m.id, draft.encoded());
    onEdit(false);
  };
  return (
    <div className={`fr-cm-msg${editing ? ' is-editing' : ''}`}>
      <Avatar name={authorName(m, people)} color={authorColor(m)} src={people[m.authorId]?.avatarUrl} size={28} />
      <div className="fr-cm-msg__body">
        <div className="fr-cm-msg__head">
          <span className="fr-cm-msg__name">{authorName(m, people)}</span>
          <Tooltip content={new Date(m.createdAt).toLocaleString()} side="top">
            <span className="fr-cm-msg__time">
              {relativeTime(m.createdAt, now)}
              {m.editedAt ? tr('edited') : ''}
            </span>
          </Tooltip>
          {(canWrite || !mine) && !editing && (
            <span className="fr-cm-msg__tools">
              {canWrite && <ReactionPicker onPick={(e) => toggleReaction(editor, thread.id, m.id, e)} />}
              {!mine && (
                // The report feature's dialog (if it is there): features never import each other.
                <IconButton
                  icon={Flag}
                  label={tr('report')}
                  size={32}
                  onClick={() => editor.runCommand('report.open', { target: { kind: 'comment', id: `${thread.id}:${m.id}` } })}
                />
              )}
              {mine && canWrite && (
                <>
                  <IconButton
                    icon={Pencil}
                    label={tr('edit')}
                    size={32}
                    onClick={() => {
                      draft.load(m.text, (id) => people[id]?.name);
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
            <MentionText
              editor={editor}
              value={draft.text}
              onChange={draft.setText}
              picks={draft.picks}
              onPicks={draft.setPicks}
              onSubmit={save}
              onEscape={() => onEdit(false)}
              placeholder={tr('editComment')}
              label={tr('editComment')}
              autoFocus
            />
            <div className="fr-cm-composer__foot">
              <SendHint />
              <Button size="sm" variant="ghost" onClick={() => onEdit(false)}>{tr('cancel')}</Button>
              <Button size="sm" variant="primary" disabled={!draft.text.trim()} onClick={save}>{tr('save')}</Button>
            </div>
          </div>
        ) : (
          <div className="fr-cm-msg__text">
            <MessageText text={m.text} people={people} meId={editor.user.id} />
          </div>
        )}
        {m.attachments?.length ? <MessageAttachments editor={editor} files={m.attachments} at={{ threadId: thread.id, messageId: m.id }} /> : null}
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
  quiet = false,
}: {
  editor: Editor;
  thread: CommentThread;
  elementMissing: boolean;
  /** Opened from elsewhere (find): the reply box doesn't take the focus. */
  quiet?: boolean;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
}) {
  const d = useMentionDraft();
  const files = useAttachDraft(editor);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const now = useNow(editor);
  const people = usePeopleOf(editor, thread.messages);
  const canWrite = editor.can('commenter');
  const canDelete = canDeleteThread(editor, thread);
  const names = new Map<string, string>();
  for (const m of thread.messages) names.set(m.authorId, authorName(m, people));
  for (const [id, u] of Object.entries(people)) names.set(id, u.name);

  // Keep the newest message in view as replies arrive.
  const count = thread.messages.length;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const ready = (!!d.text.trim() || files.items.length > 0) && !files.uploading;
  const send = () => {
    if (!ready) return;
    reply(editor, thread.id, d.encoded(), files.items);
    d.clear();
    files.clear();
  };

  return (
    <div className="fr-cm-thread">
      <div className="fr-cm-thread__head">
        <span className="fr-cm-thread__title">
          {thread.resolved ? (
            <span className="fr-cm-badge fr-cm-badge--resolved">
              <Check size={12} />{' '}{tr('resolved')}</span>
          ) : (
            tr('comment')
          )}
        </span>
        {canWrite &&
          (thread.resolved ? (
            <IconButton icon={RotateCcw} label={tr('reopen')} size={32} onClick={() => setResolved(editor, thread.id, false)} />
          ) : (
            <IconButton
              icon={Check}
              label={tr('resolve')}
              size={32}
              onClick={() => {
                setResolved(editor, thread.id, true);
                setUi(editor, { openId: null });
              }}
            />
          ))}
        {canDelete && (
          <>
            <IconButton ref={moreRef} icon={MoreHorizontal} label={tr('more')} size={32} active={menu} onClick={() => setMenu((o) => !o)} />
            <Menu
              open={menu}
              onClose={() => setMenu(false)}
              anchor={moreRef.current}
              align="end"
              minWidth={180}
              items={[{ id: 'delete', label: tr('deleteThread'), icon: Trash2, danger: true, onSelect: () => deleteThread(editor, thread.id) }]}
            />
          </>
        )}
        <IconButton icon={X} label={tr('close')} size={32} onClick={() => setUi(editor, { openId: null })} />
      </div>
      {elementMissing && <div className="fr-cm-note">{tr('theItemThisWasPinned')}</div>}
      <div className="fr-cm-thread__list" ref={listRef}>
        {thread.messages.map((m) => (
          <MessageRow
            key={m.id}
            editor={editor}
            thread={thread}
            message={m}
            canWrite={canWrite}
            names={names}
            people={people}
            now={now}
            editing={editingId === m.id}
            onEdit={(on) => setEditingId(on ? m.id : null)}
          />
        ))}
      </div>
      {canWrite && !editingId && <PendingAttachments draft={files} />}
      {canWrite && !editingId && (
        <div className="fr-cm-reply">
          <AttachButton draft={files} />
          <MentionText
            editor={editor}
            value={d.text}
            onChange={d.setText}
            picks={d.picks}
            onPicks={d.setPicks}
            onSubmit={send}
            placeholder={tr('replyToMention')}
            label={tr('reply')}
            autoFocus={!quiet}
          />
          <IconButton icon={ArrowUp} label={tr('sendReply')} shortcut="Enter" size={32} variant="solid" disabled={!ready} onClick={send} />
        </div>
      )}
    </div>
  );
}
