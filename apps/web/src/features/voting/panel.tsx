import { memo, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { ArrowLeft, History, ListOrdered, Minus, Plus, Timer, Trash2, Trophy, Vote, X } from 'lucide-react';
import { FACILITATION_COLLECTION, PARTICIPATION_KEY, participationOpen, type BoardElement, type Role, type VotingHistoryEntry } from '@freero/shared';
import { DockHeader, definePanel, useCanEdit, useCollection, useDock, usePeers, useRole, type Editor, type Rect } from '@engine';
import { AvatarStack, Button, Input, Menu, Modal, Select, Slider, Toggle, Tooltip, type MenuItem } from '@ui';
import { MAX_VOTES, MIN_VOTES, ranked, timeLeft } from './lib/voting';
import { RESULTS_PANEL_ID, START_DIALOG_ID, previewOf, useServerNow, useVoting, useVotingUi, type VotingView } from './lib/state';
import { clear, end, endWhenTimeIsUp, forget, start, unvote, vote } from './lib/actions';
import './voting.css';

/** Does the board let commenters and guests take part (the facilitation feature's switch)? */
function useParticipationOpen(): boolean {
  const entries = useCollection<unknown>(FACILITATION_COLLECTION);
  return participationOpen(entries.find(([k]) => k === PARTICIPATION_KEY)?.[1]);
}

/** "mm:ss" of a countdown, rounding up so it reads 00:01 until the very end. */
function clock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const TIMER_OPTIONS = [
  { value: 0, label: 'No timer' },
  { value: 1, label: '1 minute' },
  { value: 2, label: '2 minutes' },
  { value: 3, label: '3 minutes' },
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
];

// ---------------------------------------------------------------------------
// Start dialog
// ---------------------------------------------------------------------------
type Scope = 'all' | 'selected';

/** Selected elements people could vote on (the dialog snapshots this when it opens). */
function votableSelection(editor: Editor): string[] {
  return editor.getSelection().filter((id) => {
    const t = editor.getElement(id)?.type;
    return t && t !== 'connector' && t !== 'pen';
  });
}

function StartDialog({ editor }: { editor: Editor }) {
  const close = () => editor.closePanel(START_DIALOG_ID);
  const open = useParticipationOpen();
  const [title, setTitle] = useState('');
  const [votes, setVotes] = useState(3);
  const [anonymous, setAnonymous] = useState(true);
  const [hide, setHide] = useState(true);
  const [capOn, setCapOn] = useState(false);
  const [cap, setCap] = useState(1);
  const [minutes, setMinutes] = useState(0);
  const [picked] = useState(() => votableSelection(editor));
  const [scope, setScope] = useState<Scope>(picked.length > 1 ? 'selected' : 'all');
  const perItem = Math.min(cap, votes);

  const submit = () => {
    if (scope === 'selected' && !picked.length) return;
    start(editor, {
      title,
      votesPerUser: votes,
      hideResults: hide || anonymous,
      anonymous,
      maxPerItem: capOn && perItem < votes ? perItem : null,
      durationMs: minutes ? minutes * 60_000 : null,
      elementIds: scope === 'selected' ? picked : null,
    });
    useVotingUi.getState().hide(null);
    useVotingUi.getState().openPast(null);
    close();
  };

  return (
    <Modal
      open
      onClose={close}
      title="Start voting"
      description={open ? 'Everyone on the board can vote, including people who can only comment and guests on the link.' : 'Everyone with edit access can vote.'}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" icon={Vote} onClick={submit} disabled={scope === 'selected' && !picked.length}>
            Start voting
          </Button>
        </>
      }
    >
      <form
        className="fr-vote-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input label="Title" placeholder="What are we deciding?" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        <Slider label="Votes per person" min={MIN_VOTES} max={MAX_VOTES} value={votes} onChange={setVotes} showValue aria-label="Votes per person" />
        <div className="fr-vote-hide">
          <Toggle label="Anonymous" checked={anonymous} onChange={setAnonymous} />
          <small>
            {anonymous
              ? 'Nobody, you included, can ever see who voted for what: ballots are counted without names when the vote ends.'
              : 'After the vote, the results show who voted for what.'}
          </small>
        </div>
        <div className="fr-vote-hide">
          <Toggle label="Hide results until voting ends" checked={hide || anonymous} disabled={anonymous} onChange={setHide} />
          <small>
            {anonymous
              ? 'An anonymous vote is always counted at the end: running totals would show whose click moved which count.'
              : hide
                ? 'Each ballot stays sealed on the server, so nobody (you included) can see the votes until you end the vote.'
                : 'Everyone sees the running totals while people vote.'}
          </small>
        </div>
        <div className="fr-vote-row-opt">
          <Toggle label="Limit votes on one item" checked={capOn} onChange={setCapOn} />
          {capOn && (
            <Input
              size="sm"
              type="number"
              min={1}
              max={votes}
              value={String(perItem)}
              onChange={(e) => setCap(Math.max(1, Math.min(votes, Number.parseInt(e.target.value, 10) || 1)))}
              aria-label="Most votes one person can give one item"
              className="fr-vote-row-opt__n"
            />
          )}
        </div>
        <div className="fr-vote-row-opt">
          <span className="fr-vote-row-opt__label">
            <Timer size={15} /> Close the vote after
          </span>
          <Select options={TIMER_OPTIONS} value={minutes} onChange={setMinutes} size="sm" aria-label="Close the vote after" />
        </div>
        <fieldset className="fr-vote-scope">
          <legend>What can people vote on?</legend>
          <label className={`fr-vote-scope__opt${scope === 'all' ? ' is-on' : ''}`}>
            <input type="radio" name="fr-vote-scope" checked={scope === 'all'} onChange={() => setScope('all')} />
            <span>All stickies, cards and shapes</span>
          </label>
          <label className={`fr-vote-scope__opt${scope === 'selected' ? ' is-on' : ''}${picked.length ? '' : ' is-disabled'}`}>
            <input type="radio" name="fr-vote-scope" checked={scope === 'selected'} disabled={!picked.length} onChange={() => setScope('selected')} />
            <span>
              Only selected elements
              <small>{picked.length ? `${picked.length} selected` : 'Select elements on the board first'}</small>
            </span>
          </label>
        </fieldset>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Top bar "Vote" button
// ---------------------------------------------------------------------------
function VoteButton({ editor }: { editor: Editor }) {
  const v = useVoting();
  const canEdit = useCanEdit();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  if (!canEdit) return null;
  const { session } = v;

  const showResults = () => {
    useVotingUi.getState().hide(null);
    editor.openDock(RESULTS_PANEL_ID);
  };
  const items: MenuItem[] = [];
  const pastVotes = () => {
    useVotingUi.getState().openPast(null);
    editor.openDock(RESULTS_PANEL_ID);
  };
  if (session?.active) {
    if (v.canManage) items.push({ id: 'end', label: 'End voting', icon: Trophy, onSelect: () => end(editor) });
    items.push({ id: 'results', label: 'Voting results', icon: ListOrdered, onSelect: showResults });
  } else if (session) {
    items.push(
      { id: 'results', label: 'Show results', icon: ListOrdered, onSelect: showResults },
      { id: 'new', label: 'Start new session', icon: Vote, onSelect: () => editor.openPanel(START_DIALOG_ID) },
      { divider: true },
      { id: 'clear', label: 'Clear results', icon: X, danger: true, onSelect: () => clear(editor) },
    );
  } else if (v.history.length) {
    items.push(
      { id: 'new', label: 'Start voting', icon: Vote, onSelect: () => editor.openPanel(START_DIALOG_ID) },
      { id: 'past', label: 'Past votes', icon: History, onSelect: pastVotes },
    );
  }
  const hasMenu = items.length > 0;

  return (
    <>
      <Button
        ref={ref}
        variant="ghost"
        icon={Vote}
        className={`fr-vote-btn${session?.active ? ' is-live' : ''}`}
        aria-haspopup={hasMenu ? 'menu' : 'dialog'}
        aria-expanded={menu}
        onClick={() => (hasMenu ? setMenu((o) => !o) : editor.openPanel(START_DIALOG_ID))}
      >
        Vote
      </Button>
      <Menu open={menu} onClose={() => setMenu(false)} anchor={ref.current} side="bottom" align="end" items={items} />
    </>
  );
}

// ---------------------------------------------------------------------------
// World overlay: vote controls, result badges, dimming of ineligible elements
// ---------------------------------------------------------------------------
const NO_DIM = new Set(['frame', 'connector', 'pen']);

/** Element-local top-right corner, rotated with the element (world coords). */
function topRight(el: BoardElement): { x: number; y: number } {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const a = ((el.rotation || 0) * Math.PI) / 180;
  const dx = el.w / 2;
  const dy = -el.h / 2;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

function aabb(el: BoardElement): Rect {
  const a = ((el.rotation || 0) * Math.PI) / 180;
  const w = Math.abs(el.w * Math.cos(a)) + Math.abs(el.h * Math.sin(a));
  const h = Math.abs(el.w * Math.sin(a)) + Math.abs(el.h * Math.cos(a));
  return { x: el.x + el.w / 2 - w / 2, y: el.y + el.h / 2 - h / 2, w, h };
}

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Keeps controls a constant on-screen size (via a CSS variable, no React re-render per frame)
 * and returns a padded cull rect that only changes when the view leaves it.
 */
function useCameraLayer(editor: Editor, layer: RefObject<HTMLDivElement>): Rect | null {
  const [cull, setCull] = useState<Rect | null>(null);
  useEffect(() => {
    let current: Rect | null = null;
    let zoomAt = 0;
    const apply = () => {
      const cam = editor.getCamera();
      layer.current?.style.setProperty('--fr-vote-s', String(1 / Math.max(cam.zoom, 0.35)));
      const vp = editor.getViewportSize();
      const view = { x: cam.x, y: cam.y, w: vp.width / cam.zoom, h: vp.height / cam.zoom };
      const inside =
        current &&
        view.x >= current.x &&
        view.y >= current.y &&
        view.x + view.w <= current.x + current.w &&
        view.y + view.h <= current.y + current.h &&
        cam.zoom / zoomAt < 1.6 &&
        zoomAt / cam.zoom < 1.6;
      if (inside) return;
      const pad = Math.max(view.w, view.h) * 0.5;
      current = { x: view.x - pad, y: view.y - pad, w: view.w + pad * 2, h: view.h + pad * 2 };
      zoomAt = cam.zoom;
      setCull(current);
    };
    apply();
    return editor.on('camera', apply);
  }, [editor, layer]);
  return cull;
}

const VoteControl = memo(function VoteControl({
  editor,
  el,
  mine,
  total,
  canVote,
  noVotesLeft,
}: {
  editor: Editor;
  el: BoardElement;
  mine: number;
  total: number | null;
  canVote: boolean;
  noVotesLeft: boolean;
}) {
  const p = topRight(el);
  const onAdd = (e: MouseEvent) => {
    e.stopPropagation();
    if (e.altKey) unvote(editor, el.id);
    else vote(editor, el.id);
  };
  return (
    <div className="fr-vote-anchor" style={{ transform: `translate(${p.x}px, ${p.y}px) scale(var(--fr-vote-s, 1))` }}>
      <div className={`fr-vote-ctl${mine ? ' has-mine' : ''}`} data-fr-interactive="">
        {total != null && total > 0 && (
          <span className="fr-vote-ctl__total" title={`${total} vote${total === 1 ? '' : 's'} in total`}>
            {total}
          </span>
        )}
        {canVote && mine > 0 && (
          <button
            type="button"
            className="fr-vote-ctl__minus"
            aria-label="Remove one of your votes"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              unvote(editor, el.id);
            }}
          >
            <Minus size={14} strokeWidth={2.5} />
          </button>
        )}
        {canVote && (
          <button
            type="button"
            className={`fr-vote-ctl__plus${noVotesLeft ? ' is-spent' : ''}`}
            aria-label={mine ? `Your votes: ${mine}. Add a vote (Alt-click removes one)` : 'Add a vote (Alt-click removes one)'}
            title="Click to vote · Alt-click to remove"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onAdd}
          >
            <Plus size={14} strokeWidth={2.5} />
            {mine > 0 && <span className="fr-vote-ctl__mine">{mine}</span>}
          </button>
        )}
      </div>
    </div>
  );
});

function ResultBadge({ el, votes, rank }: { el: BoardElement; votes: number; rank: number }) {
  const p = topRight(el);
  return (
    <div className="fr-vote-anchor" style={{ transform: `translate(${p.x}px, ${p.y}px) scale(var(--fr-vote-s, 1))` }}>
      <div className={`fr-vote-badge${rank === 1 ? ' is-top' : ''}`} title={`${votes} vote${votes === 1 ? '' : 's'}`}>
        {votes}
      </div>
    </div>
  );
}

function VotingWorld({ editor }: { editor: Editor }) {
  const v = useVoting();
  const layer = useRef<HTMLDivElement>(null);
  const cull = useCameraLayer(editor, layer);
  const { session } = v;
  if (!session || !v.visible) return <div ref={layer} />;
  const inView = (el: BoardElement) => !cull || intersects(aabb(el), cull);

  if (!session.active) {
    const rankOf = new Map(v.ranking.map((r) => [r.id, r.rank]));
    return (
      <div ref={layer} className="fr-vote-layer">
        {v.eligible.filter(inView).map((el) => {
          const n = v.totals.get(el.id) ?? 0;
          return n > 0 ? <ResultBadge key={el.id} el={el} votes={n} rank={rankOf.get(el.id) ?? 99} /> : null;
        })}
      </div>
    );
  }
  return (
    <div ref={layer} className="fr-vote-layer">
      {v.ineligible.filter((el) => !NO_DIM.has(el.type) && inView(el)).map((el) => (
        <div
          key={el.id}
          className="fr-vote-dim"
          style={{ width: el.w, height: el.h, transform: `translate(${el.x}px, ${el.y}px) rotate(${el.rotation || 0}deg)` }}
        />
      ))}
      {v.eligible.filter(inView).map((el) => (
        <VoteControl
          key={el.id}
          editor={editor}
          el={el}
          mine={v.mine.get(el.id) ?? 0}
          total={v.showTotals ? (v.totals.get(el.id) ?? 0) : null}
          canVote={v.canVote}
          noVotesLeft={v.votesLeft === 0}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating session bar (screen space)
// ---------------------------------------------------------------------------
function votesLeftText(v: VotingView, role: Role, closed: boolean): string {
  if (closed) return "Time's up: no more votes";
  if (!v.canVote)
    return role === 'commenter' ? 'You can comment; voting is open to editors on this board' : 'View only: you can watch, but not vote';
  if (!v.eligible.length) return 'Nothing to vote on yet';
  if (v.votesLeft === 0) return "You've used all your votes";
  return `You have ${v.votesLeft} vote${v.votesLeft === 1 ? '' : 's'} left`;
}

function SessionBar({ editor }: { editor: Editor }) {
  const v = useVoting();
  const canEdit = useCanEdit();
  const role = useRole();
  const dock = useDock();
  const peers = usePeers();
  const { session } = v;
  const timed = !!session?.active && session.endsAt != null;
  const now = useServerNow(editor, timed);
  const left = session ? timeLeft(session, now) : null;
  const closed = left === 0;
  // The timer ran out: the vote ends (the server already takes no more ballots).
  const onBoard = useMemo(() => {
    const ids = new Set([editor.user.id, ...peers.map((p) => p.user?.id)]);
    return (id: string) => ids.has(id);
  }, [editor, peers]);
  useEffect(() => {
    if (closed && canEdit) endWhenTimeIsUp(editor, onBoard);
  }, [closed, canEdit, editor, onBoard]);
  if (!session || !v.visible) return null;
  const people = v.voters.length;
  const anonymous = !!session.anonymousBallots;

  if (session.active) {
    return (
      <div className="fr-vote-bar" data-fr-interactive="" role="region" aria-label="Voting session">
        <span className="fr-vote-bar__icon">
          <Vote size={16} />
        </span>
        <div className="fr-vote-bar__text">
          <strong>
            {session.title}
            {anonymous && <span className="fr-vote-bar__tag">Anonymous</span>}
          </strong>
          <span className={(v.canVote && v.votesLeft === 0) || closed ? 'is-spent' : undefined}>
            {votesLeftText(v, role, closed)}
            {session.maxPerItem ? ` · at most ${session.maxPerItem} per item` : ''}
          </span>
        </div>
        {left !== null && (
          <span className={`fr-vote-bar__clock${left < 10_000 ? ' is-low' : ''}`} aria-label="Time left to vote" role="timer">
            <Timer size={14} />
            {clock(left)}
          </span>
        )}
        <div className="fr-vote-bar__voters">
          {people ? (
            anonymous ? (
              <span className="fr-vote-bar__muted">{people} voted</span>
            ) : (
              <Tooltip content={v.voters.map((p) => p.name).join(', ')} side="bottom">
                <span className="fr-vote-bar__stack">
                  <AvatarStack users={v.voters} max={4} size={24} />
                  <span>{people} voted</span>
                </span>
              </Tooltip>
            )
          ) : (
            <span className="fr-vote-bar__muted">No votes yet</span>
          )}
        </div>
        {v.canManage && (
          <Button size="sm" variant="primary" icon={Trophy} onClick={() => end(editor)}>
            End voting
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="fr-vote-bar is-results" data-fr-interactive="" role="region" aria-label="Voting results">
      <span className="fr-vote-bar__icon">
        <Trophy size={16} />
      </span>
      <div className="fr-vote-bar__text">
        <strong>Results: {session.title}</strong>
        <span>
          {v.totalVotes} vote{v.totalVotes === 1 ? '' : 's'} from {people} {people === 1 ? 'person' : 'people'}
          {anonymous ? ' · anonymous' : ''}
        </span>
      </div>
      {dock !== RESULTS_PANEL_ID && (
        <Button
          size="sm"
          icon={ListOrdered}
          onClick={() => {
            useVotingUi.getState().openPast(null);
            editor.openDock(RESULTS_PANEL_ID);
          }}
        >
          View results
        </Button>
      )}
      {canEdit && (
        <Button size="sm" variant="ghost" icon={Vote} onClick={() => editor.openPanel(START_DIALOG_ID)}>
          Start new session
        </Button>
      )}
      <Tooltip content="Hide results" side="bottom">
        <button
          type="button"
          className="fr-vote-bar__close"
          aria-label="Hide results"
          onClick={() => {
            useVotingUi.getState().hide(session.id);
            if (editor.getDock() === RESULTS_PANEL_ID) editor.openDock(null);
          }}
        >
          <X size={16} />
        </button>
      </Tooltip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dock: results list
// ---------------------------------------------------------------------------
/** Screen px kept around revealed results (inside the part of the board the chrome leaves free). */
const PAD_PX = 72;

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
/** A ranked results list (the current vote's, or a past one's), with "Select top N". */
function RankedList({ editor, ranking }: { editor: Editor; ranking: Array<{ id: string; votes: number; rank: number }> }) {
  const [topN, setTopN] = useState('3');
  const rows = ranking.filter((r) => editor.getElement(r.id));
  if (!rows.length) return <p className="fr-vote-results__empty">No votes on items that are still on the board.</p>;
  const n = Math.max(1, Math.min(rows.length, Number.parseInt(topN, 10) || 0));
  const max = rows[0].votes;
  const focus = (id: string) => {
    editor.select([id]);
    editor.zoomToFit([id], { maxZoom: 1.25, padding: PAD_PX });
  };
  return (
    <>
      <div className="fr-vote-results__top">
        <span>Select top</span>
        <Input
          size="sm"
          type="number"
          min={1}
          max={rows.length}
          value={topN}
          onChange={(e) => setTopN(e.target.value)}
          aria-label="Number of top results to select"
          className="fr-vote-results__n"
        />
        <Button
          size="sm"
          onClick={() => {
            const ids = rows.slice(0, n).map((r) => r.id);
            editor.select(ids);
            editor.zoomToFit(ids, { maxZoom: 1, padding: PAD_PX });
          }}
        >
          Select
        </Button>
      </div>
      <ol className="fr-vote-results__list">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" className="fr-vote-row" onClick={() => focus(r.id)}>
              <span className={`fr-vote-row__rank${r.rank === 1 ? ' is-top' : ''}`}>{r.rank}</span>
              <span className="fr-vote-row__main">
                <span className="fr-vote-row__text">{previewOf(editor, editor.getElement(r.id)!)}</span>
                <span className="fr-vote-row__bar">
                  <span style={{ width: `${(r.votes / max) * 100}%` }} />
                </span>
              </span>
              <span className="fr-vote-row__votes">{r.votes}</span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

const dateOf = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** A past vote reopened from the history: its results as they were when the next vote started. */
function PastResults({ editor, entry, order }: { editor: Editor; entry: VotingHistoryEntry; order: string[] }) {
  const canEdit = useCanEdit();
  const total = entry.totals.reduce((n, [, v]) => n + v, 0);
  return (
    <>
      <button type="button" className="fr-vote-results__back" onClick={() => useVotingUi.getState().openPast(null)}>
        <ArrowLeft size={14} /> All votes
      </button>
      <div className="fr-vote-results__meta">
        <strong>{entry.session.title}</strong>
        <span>
          {dateOf(entry.session.endedAt ?? entry.archivedAt)} · {total} vote{total === 1 ? '' : 's'} · {entry.voters} {entry.voters === 1 ? 'voter' : 'voters'}
          {entry.session.anonymousBallots ? ' · anonymous' : ''}
        </span>
      </div>
      <RankedList editor={editor} ranking={ranked(new Map(entry.totals), order)} />
      {canEdit && (
        <Button
          variant="ghost"
          icon={Trash2}
          block
          onClick={() => {
            forget(editor, entry.session.id);
            useVotingUi.getState().openPast(null);
          }}
        >
          Delete from history
        </Button>
      )}
    </>
  );
}

function ResultsPanel({ editor }: { editor: Editor }) {
  const v = useVoting();
  const canEdit = useCanEdit();
  const pastId = useVotingUi((s) => s.pastId);
  const { session } = v;
  const order = useMemo(() => editor.getElements().map((e) => e.id), [editor, v.eligible]);
  const past = pastId ? v.history.find((h) => h.session.id === pastId) : undefined;

  let body;
  if (past) {
    body = <PastResults editor={editor} entry={past} order={order} />;
  } else if (!session) {
    body = <p className="fr-vote-results__empty">{v.history.length ? 'No vote running. Earlier votes are listed below.' : 'No voting session on this board yet.'}</p>;
  } else if (session.active && session.anonymous) {
    body = (
      <p className="fr-vote-results__empty">
        Ballots are sealed on the server until voting ends{session.anonymousBallots ? ', and counted without names' : ''}. {v.voters.length}{' '}
        {v.voters.length === 1 ? 'person has' : 'people have'} voted so far.
      </p>
    );
  } else if (!v.ranking.length) {
    body = <p className="fr-vote-results__empty">No votes yet.</p>;
  } else {
    body = <RankedList editor={editor} ranking={v.ranking} />;
  }

  return (
    <div className="fr-vote-results">
      <DockHeader className="fr-vote-results__head">
        <h2 className="fr-vote-results__title">Voting results</h2>
      </DockHeader>
      {session && !past && (
        <div className="fr-vote-results__meta">
          <strong>{session.title}</strong>
          <span>
            {session.active ? 'In progress' : 'Ended'} · {v.totalVotes} vote{v.totalVotes === 1 ? '' : 's'} · {v.voters.length}{' '}
            {v.voters.length === 1 ? 'voter' : 'voters'}
            {session.anonymousBallots ? ' · anonymous' : ''}
          </span>
        </div>
      )}
      {body}
      {canEdit && !past && (!session || !session.active) && (
        <Button variant="secondary" icon={Vote} block onClick={() => editor.openPanel(START_DIALOG_ID)}>
          {session ? 'Start new session' : 'Start voting'}
        </Button>
      )}
      {!past && v.history.length > 0 && (
        <section className="fr-vote-history" aria-label="Past votes">
          <h3>
            <History size={14} /> Past votes
          </h3>
          <ul>
            {v.history.map((h) => {
              const total = h.totals.reduce((n, [, x]) => n + x, 0);
              return (
                <li key={h.session.id}>
                  <button type="button" className="fr-vote-history__row" onClick={() => useVotingUi.getState().openPast(h.session.id)}>
                    <span className="fr-vote-history__title">{h.session.title}</span>
                    <span className="fr-vote-history__meta">
                      {dateOf(h.session.endedAt ?? h.archivedAt)} · {total} vote{total === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

export default [
  definePanel({ id: 'voting.button', slot: 'topbar-right', order: 30, Component: VoteButton }),
  definePanel({ id: 'voting.world', slot: 'world-overlay', order: 50, Component: VotingWorld }),
  definePanel({ id: 'voting.bar', slot: 'top-center', order: 50, Component: SessionBar }),
  definePanel({ id: RESULTS_PANEL_ID, slot: 'dock-right', order: 50, Component: ResultsPanel }),
  definePanel({ id: START_DIALOG_ID, slot: 'dialog', order: 50, Component: StartDialog }),
];
