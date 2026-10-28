import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, MessageCircle, MessageSquareText, Unlink } from 'lucide-react';
import type { BoardElement, CommentThread } from '@freero/shared';
import { definePanel, useCamera, useCollection, useDock, useElements, useRole, type Editor, type HostUser } from '@engine';
import { Avatar, IconButton, Popover, SegmentedControl, Toggle, type Box } from '@ui';
import { assembleThreads, isUnread, latestActivity, listThreads, relativeTime, threadPoint, type ThreadFilter } from './lib/model';
import { COLLECTION, PANEL_ID, detachThread, focusThread, markSeen, session, setUi, useCommentsUi, watchLegacyThreads } from './lib/state';
import { MessageText } from './lib/composer';
import { usePeopleOf } from './lib/people';
import { DraftComposer, ThreadView, authorColor, useNow } from './lib/views';
import './comments.css';

function useThreads(): CommentThread[] {
  const entries = useCollection<unknown>(COLLECTION);
  return useMemo(() => assembleThreads(entries), [entries]);
}

function useUnreadCount(editor: Editor, threads: CommentThread[]): number {
  const seen = useCommentsUi(editor, (s) => s.seen);
  return threads.filter((t) => !t.resolved && isUnread(t, seen[t.id], editor.user.id)).length;
}

// ---------------------------------------------------------------------------
// Pins (world-overlay)
// ---------------------------------------------------------------------------
const Pin = memo(function Pin(props: {
  x: number;
  y: number;
  scale: number;
  name: string;
  color: string;
  avatarUrl: string | null;
  replies: number;
  unread: boolean;
  resolved: boolean;
  active: boolean;
  ghost?: boolean;
  label: string;
  pinRef?: (el: HTMLDivElement | null) => void;
  onOpen?: () => void;
}) {
  const { x, y, scale, name, color, avatarUrl, replies, unread, resolved, active, ghost, label, pinRef, onOpen } = props;
  return (
    <div
      className="fr-cm-pin-anchor"
      style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}
    >
      <div
        ref={pinRef}
        className={`fr-cm-pin${active ? ' is-active' : ''}${resolved ? ' is-resolved' : ''}${ghost ? ' is-ghost' : ''}${unread ? ' is-unread' : ''}`}
        data-fr-interactive=""
        data-fr-keep-clear=""
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-label={label}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
        }}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (onOpen && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        {resolved ? <Check size={16} strokeWidth={2.6} /> : <Avatar name={name} color={color} src={avatarUrl} size={26} />}
        {replies > 0 && <span className="fr-cm-pin__count">{replies}</span>}
        {unread && !resolved && <span className="fr-cm-pin__dot" />}
      </div>
    </div>
  );
});

/** Screen box of a pin element, re-measured whenever the camera or the pin moves. */
function usePinBox(el: HTMLElement | null, deps: unknown[]): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    if (!el) return setBox(null);
    const r = el.getBoundingClientRect();
    setBox((b) => (b && b.x === r.x && b.y === r.y && b.width === r.width && b.height === r.height ? b : { x: r.x, y: r.y, width: r.width, height: r.height }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, ...deps]);
  return box;
}

function Pins({ editor }: { editor: Editor }) {
  const threads = useThreads();
  const elements = useElements();
  const cam = useCamera();
  const role = useRole();
  const { draft, openId, quietId, showResolved, seen } = useCommentsUi(editor, (s) => s);
  // Pin DOM nodes, so popovers can anchor to them. Ref callbacks are cached per id: a fresh
  // callback each render would detach/attach every pin on every render.
  const [pinEls] = useState(() => new Map<string, HTMLDivElement>());
  const [, setPinVersion] = useState(0);
  const refCache = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const [editingId, setEditingId] = useState<string | null>(null);
  // Clicking the open pin dismisses the popover (outside click) before the pin's own click
  // runs; remember that so the click toggles it closed instead of reopening it.
  const justClosed = useRef<{ id: string; at: number } | null>(null);
  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);
  const scale = 1 / cam.zoom;
  const open = openId ? threads.find((t) => t.id === openId) : undefined;
  const firsts = useMemo(() => threads.map((t) => t.messages[0]), [threads]);
  const people = usePeopleOf(editor, firsts);

  // Threads on an element that gets deleted stay where the element was (unpinned).
  const lastGeom = useRef(new Map<string, BoardElement>());
  useEffect(() => {
    for (const t of threads) {
      if (!t.elementId) continue;
      const el = byId.get(t.elementId);
      if (el) lastGeom.current.set(t.elementId, el);
      else {
        const last = lastGeom.current.get(t.elementId);
        if (last && editor.can('commenter')) detachThread(editor, t.id, threadPoint(t, last));
      }
    }
  }, [editor, threads, byId, role]);

  // An open thread whose data disappeared (deleted elsewhere) closes.
  useEffect(() => {
    if (openId && !open) setUi(editor, { openId: null });
  }, [editor, openId, open]);
  // Reading an open thread marks it seen, including replies that arrive while it's open.
  const openActivity = open ? latestActivity(open) : 0;
  useEffect(() => {
    if (open) markSeen(editor, open.id, openActivity);
  }, [editor, open?.id, openActivity]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setEditingId(null), [openId]);

  const openEl = openId ? (pinEls.get(openId) ?? null) : null;
  const draftEl = draft ? (pinEls.get('__draft') ?? null) : null;
  const openBox = usePinBox(openEl, [cam, open?.x, open?.y, byId.get(open?.elementId ?? '')]);
  const draftBox = usePinBox(draftEl, [cam, draft]);

  const refFor = (id: string) => {
    let fn = refCache.current.get(id);
    if (!fn) {
      fn = (el: HTMLDivElement | null) => {
        const had = pinEls.get(id) ?? null;
        if (el) pinEls.set(id, el);
        else pinEls.delete(id);
        if (had !== el) setPinVersion((v) => v + 1);
      };
      refCache.current.set(id, fn);
    }
    return fn;
  };

  const draftPoint = draft ? threadPoint(draft, draft.elementId ? byId.get(draft.elementId) : undefined, cam.zoom) : null;

  return (
    <>
      {threads.map((t) => {
        if (t.resolved && !showResolved && t.id !== openId) return null;
        const p = threadPoint(t, t.elementId ? byId.get(t.elementId) : undefined, cam.zoom);
        const first = t.messages[0];
        return (
          <Pin
            key={t.id}
            x={p.x}
            y={p.y}
            scale={scale}
            name={first.authorName}
            color={authorColor(first)}
            avatarUrl={people[first.authorId]?.avatarUrl ?? null}
            replies={t.messages.length - 1}
            unread={isUnread(t, seen[t.id], editor.user.id)}
            resolved={t.resolved}
            active={t.id === openId}
            label={`Comment by ${first.authorName}`}
            pinRef={refFor(t.id)}
            onOpen={() => {
              const jc = justClosed.current;
              if (jc && jc.id === t.id && performance.now() - jc.at < 400) return;
              setUi(editor, { openId: t.id === openId ? null : t.id, draft: null });
            }}
          />
        );
      })}
      {draft && draftPoint && (
        <Pin
          x={draftPoint.x}
          y={draftPoint.y}
          scale={scale}
          name={editor.user.name}
          color={editor.user.color}
          avatarUrl={editor.user.avatarUrl}
          replies={0}
          unread={false}
          resolved={false}
          active
          ghost
          label="New comment"
          pinRef={refFor('__draft')}
        />
      )}
      <Popover
        open={!!draft && !!draftBox}
        onClose={() => setUi(editor, { draft: null })}
        anchor={draftBox}
        // Esc with the @mention list open closes just the list.
        escapeToContent
        side="right"
        align="start"
        offset={10}
        width={320}
        aria-label="New comment"
      >
        {draft && <DraftComposer key={`${draft.x},${draft.y},${draft.elementId}`} editor={editor} />}
      </Popover>
      <Popover
        open={!!open && !!openBox}
        // Esc while editing a message cancels the edit (the edit box keeps Escape); clicking
        // away while editing also just cancels the edit.
        escapeToContent
        autoFocus={quietId !== openId}
        onClose={() => {
          if (editingId) return setEditingId(null);
          if (openId) justClosed.current = { id: openId, at: performance.now() };
          setUi(editor, { openId: null });
        }}
        anchor={openBox}
        side="right"
        align="start"
        offset={10}
        width={340}
        className="fr-cm-popover"
        aria-label="Comment thread"
      >
        {open && (
          <ThreadView
            key={open.id}
            editor={editor}
            thread={open}
            elementMissing={!!open.elementId && !byId.has(open.elementId)}
            quiet={quietId === open.id}
            editingId={editingId}
            setEditingId={setEditingId}
          />
        )}
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------------------
// Comments list (dock-right)
// ---------------------------------------------------------------------------
function ThreadCard(props: { editor: Editor; thread: CommentThread; unread: boolean; now: number; missing: boolean; people: Record<string, HostUser> }) {
  const { editor, thread, unread, now, missing, people } = props;
  const first = thread.messages[0];
  const replies = thread.messages.length - 1;
  return (
    <button type="button" className={`fr-cm-card${unread ? ' is-unread' : ''}`} onClick={() => focusThread(editor, thread)}>
      <div className="fr-cm-card__head">
        <Avatar name={first.authorName} color={authorColor(first)} src={people[first.authorId]?.avatarUrl} size={24} />
        <span className="fr-cm-card__name">{first.authorName}</span>
        <span className="fr-cm-card__time">{relativeTime(latestActivity(thread), now)}</span>
        {unread && <span className="fr-cm-card__dot" aria-label="Unread" />}
      </div>
      <div className="fr-cm-card__text">
        <MessageText text={first.text} people={people} meId={editor.user.id} />
      </div>
      {(replies > 0 || thread.resolved || missing) && (
        <div className="fr-cm-card__foot">
          {replies > 0 && (
            <span>
              <MessageCircle size={13} /> {replies} {replies === 1 ? 'reply' : 'replies'}
            </span>
          )}
          {thread.resolved && (
            <span className="fr-cm-badge fr-cm-badge--resolved">
              <Check size={12} /> Resolved
            </span>
          )}
          {missing && (
            <span>
              <Unlink size={13} /> Item deleted
            </span>
          )}
        </div>
      )}
    </button>
  );
}

const FILTERS: Array<{ value: ThreadFilter; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'mine', label: 'Mine' },
];

function CommentsDock({ editor }: { editor: Editor }) {
  const threads = useThreads();
  const elements = useElements();
  const { filter, showResolved, seen } = useCommentsUi(editor, (s) => s);
  const now = useNow(editor);
  const ids = useMemo(() => new Set(elements.map((e) => e.id)), [elements]);
  const list = listThreads(threads, filter, editor.user.id);
  const firsts = useMemo(() => threads.map((t) => t.messages[0]), [threads]);
  const people = usePeopleOf(editor, firsts);
  const canWrite = editor.can('commenter');
  return (
    <div className="fr-cm-dock">
      <div className="fr-cm-dock__head">
        <h2>Comments</h2>
        <SegmentedControl<ThreadFilter> size="sm" value={filter} onChange={(v) => setUi(editor, { filter: v })} options={FILTERS} aria-label="Filter comments" />
        <Toggle size="sm" label="Show resolved on board" checked={showResolved} onChange={(v) => setUi(editor, { showResolved: v })} />
      </div>
      {list.length ? (
        <div className="fr-cm-dock__list">
          {list.map((t) => (
            <ThreadCard
              key={t.id}
              editor={editor}
              thread={t}
              now={now}
              unread={isUnread(t, seen[t.id], editor.user.id)}
              missing={!!t.elementId && !ids.has(t.elementId)}
              people={people}
            />
          ))}
        </div>
      ) : (
        <div className="fr-cm-empty">
          <MessageSquareText size={28} strokeWidth={1.6} />
          <div className="fr-cm-empty__title">
            {filter === 'open' ? 'No open comments' : filter === 'resolved' ? 'Nothing resolved yet' : 'You haven’t commented yet'}
          </div>
          {canWrite && filter !== 'resolved' && <div className="fr-cm-empty__hint">Press C, then click anywhere on the board to start a thread.</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle (bottom-right)
// ---------------------------------------------------------------------------
function CommentsToggle({ editor }: { editor: Editor }) {
  const threads = useThreads();
  const unread = useUnreadCount(editor, threads);
  const dock = useDock();
  const open = dock === PANEL_ID;
  return (
    <IconButton
      icon={MessageCircle}
      label={unread ? `Comments (${unread} unread)` : 'Comments'}
      size={32}
      tooltipSide="top"
      active={open}
      className="fr-cm-toggle"
      onClick={() => editor.openDock(open ? null : PANEL_ID)}
    >
      {unread > 0 && <span className="fr-cm-toggle__badge">{unread > 99 ? '99+' : unread}</span>}
    </IconButton>
  );
}

function PinsRoot({ editor }: { editor: Editor }) {
  session(editor);
  const role = useRole();
  useEffect(() => watchLegacyThreads(editor), [editor, role]);
  return <Pins editor={editor} />;
}

export default [
  definePanel({ id: 'comments.pins', slot: 'world-overlay', order: 50, Component: PinsRoot }),
  definePanel({ id: PANEL_ID, slot: 'dock-right', order: 50, Component: CommentsDock }),
  definePanel({ id: 'comments.toggle', slot: 'bottom-right', order: 10, Component: CommentsToggle }),
];
