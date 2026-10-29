// Comments on a doc's blocks (KAI-162): the boards' comment records in the doc's own Yjs document
// (a thread's elementId = its block), so the server's commenter rules, @mention notifications and
// the account purge apply unchanged. @mentions are `<@userId>` tokens, made only from names picked
// in the member list; readers see each person's CURRENT name.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Check, RotateCcw, Trash2, X } from 'lucide-react';
import { MENTION_RE, mentionToken, type Role } from '@freero/shared';
import { deleteRecord, newThread, replyRecord, setResolved, type CommentAuthor, type DocThread, type HostUser, type ObjectDocStore } from '@engine';
import { Avatar, Button, IconButton, Menu, TextArea } from '@ui';
import { listMembers, lookupUsers } from '../../hostServices';

interface Props {
  docId: string;
  store: ObjectDocStore;
  threads: DocThread[];
  me: CommentAuthor;
  canComment: boolean;
  /** A new thread is being written on this block (null: on the doc; undefined: none). */
  draftBlock: string | null | undefined;
  onDraftDone(): void;
  active: string | null;
  onActivate(thread: DocThread | null): void;
  onClose(): void;
}

/** Names picked from the member list in a composer become `<@id>` tokens on send. */
function useMentions(docId: string) {
  const [members, setMembers] = useState<HostUser[]>([]);
  useEffect(() => {
    let cancelled = false;
    listMembers(docId).then(
      (m) => !cancelled && setMembers(m),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [docId]);
  return members;
}

function Composer({ docId, placeholder, onSend, onCancel, autoFocus }: { docId: string; placeholder: string; onSend(text: string): void; onCancel?(): void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const picked = useRef(new Map<string, string>());
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const members = useMentions(docId);
  const send = () => {
    let out = text.trim();
    if (!out) return;
    // Longest names first, so "@Ann Lee" wins over "@Ann".
    for (const [name, id] of [...picked.current].sort((a, b) => b[0].length - a[0].length)) out = out.split(`@${name}`).join(mentionToken(id));
    onSend(out);
    setText('');
    picked.current.clear();
  };
  return (
    <div className="fr-doccomments-composer">
      <TextArea
        autoFocus={autoFocus}
        rows={2}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
      />
      <div className="fr-doccomments-composer__row">
        <IconButton icon={AtSign} size={32} label="Mention someone" onClick={(e) => setAnchor(e.currentTarget)} />
        <Menu
          open={!!anchor}
          anchor={anchor}
          onClose={() => setAnchor(null)}
          items={
            members.length
              ? members.map((m) => ({
                  id: m.id,
                  label: m.name,
                  onSelect: () => {
                    picked.current.set(m.name, m.id);
                    setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${m.name} `);
                  },
                }))
              : [{ id: 'none', label: 'Nobody else has access yet', disabled: true, onSelect: () => undefined }]
          }
        />
        <div className="fr-docpage-spacer" />
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" variant="primary" disabled={!text.trim()} onClick={send}>
          Comment
        </Button>
      </div>
    </div>
  );
}

export function DocComments({ docId, store, threads, me, canComment, draftBlock, onDraftDone, active, onActivate, onClose }: Props) {
  const [showResolved, setShowResolved] = useState(false);
  const [names, setNames] = useState(new Map<string, string>());
  // Current names of authors and mentioned people (renames show; a deleted account reads as such).
  const ids = useMemo(() => {
    const s = new Set<string>();
    for (const t of threads) for (const m of t.messages) {
      s.add(m.authorId);
      for (const x of m.text.matchAll(MENTION_RE)) s.add(x[1]);
    }
    return [...s].sort();
  }, [threads]);
  const idsKey = ids.join(',');
  useEffect(() => {
    if (!ids.length) return;
    let cancelled = false;
    lookupUsers(docId, ids).then(
      (people) => !cancelled && setNames(new Map(people.map((p) => [p.id, p.name]))),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, idsKey]);
  const show = (text: string) => text.replace(MENTION_RE, (_, id: string) => `@${names.get(id) ?? 'someone'}`);

  const open = threads.filter((t) => !t.resolved);
  const resolved = threads.filter((t) => t.resolved);
  const write = (records: Record<string, unknown>) => store.writeComments(records);

  const renderThread = (t: DocThread) => (
    <li key={t.id} className={`fr-doccomments-thread${t.id === active ? ' fr-doccomments-thread--active' : ''}`} onClick={() => onActivate(t)}>
      {t.messages.map((m, i) => (
        <div key={m.id} className="fr-doccomments-message">
          <Avatar name={names.get(m.authorId) ?? m.authorName} color={m.authorColor ?? '#888'} size={24} />
          <div className="fr-doccomments-message__body">
            <div className="fr-doccomments-message__head">
              <strong>{names.get(m.authorId) ?? m.authorName}</strong>
              <time dateTime={new Date(m.createdAt).toISOString()}>{new Date(m.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
              {i > 0 && m.authorId === me.id && canComment && (
                <IconButton icon={Trash2} size={32} label="Delete this reply" onClick={(e) => (e.stopPropagation(), write(deleteRecord(t.id, me.id, m.id)))} />
              )}
            </div>
            <p>{show(m.text)}</p>
          </div>
        </div>
      ))}
      {canComment && (
        <div className="fr-doccomments-actions" onClick={(e) => e.stopPropagation()}>
          <IconButton
            icon={t.resolved ? RotateCcw : Check}
            size={32}
            label={t.resolved ? 'Reopen' : 'Resolve'}
            onClick={() => write(setResolved(t.id, !t.resolved, me.id))}
          />
          {t.createdBy === me.id && <IconButton icon={Trash2} size={32} label="Delete thread" onClick={() => write(deleteRecord(t.id, me.id))} />}
        </div>
      )}
      {canComment && t.id === active && !t.resolved && (
        <div onClick={(e) => e.stopPropagation()}>
          <Composer docId={docId} placeholder="Reply" onSend={(text) => write(replyRecord(t.id, me, text))} />
        </div>
      )}
      {!t.blockId && <p className="fr-doccomments-orphan">On the whole doc</p>}
    </li>
  );

  return (
    <aside className="fr-docpage-panel" aria-label="Comments">
      <header className="fr-docpage-panel__head">
        <h2>Comments</h2>
        <IconButton icon={X} label="Close comments" onClick={onClose} />
      </header>
      <div className="fr-docpage-panel__body">
        {draftBlock !== undefined && canComment && (
          <Composer
            docId={docId}
            autoFocus
            placeholder={draftBlock ? 'Comment on this block' : 'Comment on the doc'}
            onCancel={onDraftDone}
            onSend={(text) => {
              const { threadId, records } = newThread(draftBlock, me, text);
              write(records);
              onDraftDone();
              onActivate({ id: threadId, blockId: draftBlock, resolved: false, createdBy: me.id, createdAt: Date.now(), messages: [] });
            }}
          />
        )}
        {!open.length && draftBlock === undefined && (
          <p className="fr-docpage-empty">{canComment ? 'No open comments. Put the cursor in a block and choose “Comment on this block”.' : 'No open comments.'}</p>
        )}
        <ul className="fr-doccomments-list">{open.map(renderThread)}</ul>
        {resolved.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setShowResolved((s) => !s)}>
            {showResolved ? 'Hide resolved' : `Show resolved (${resolved.length})`}
          </Button>
        )}
        {showResolved && <ul className="fr-doccomments-list fr-doccomments-list--resolved">{resolved.map(renderThread)}</ul>}
      </div>
    </aside>
  );
}

export type { Role };
