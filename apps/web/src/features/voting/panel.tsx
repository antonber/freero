import { memo, useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { ArrowLeft, History, ListOrdered, Minus, Plus, Timer, Trash2, Trophy, Vote, X } from 'lucide-react';
import { FACILITATION_COLLECTION, PARTICIPATION_KEY, participationOpen, type BoardElement, type Role, type VotingHistoryEntry } from '@freero/shared';
import { DockHeader, definePanel, useCanEdit, useCollection, useDock, usePeers, useRole, type Editor, type Rect } from '@engine';
import { AvatarStack, Button, Input, Menu, Modal, Select, Slider, Toggle, Tooltip, type MenuItem } from '@ui';
import { MAX_VOTES, MIN_VOTES, ranked, timeLeft } from './lib/voting';
import { RESULTS_PANEL_ID, START_DIALOG_ID, previewOf, useServerNow, useVoting, useVotingUi, type VotingView } from './lib/state';
import { clear, end, endWhenTimeIsUp, forget, start, unvote, vote } from './lib/actions';
import { t as tr } from './messages';
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
  { value: 0, label: tr('noTimer') },
  { value: 1, label: tr('n1Minute') },
  { value: 2, label: tr('n2Minutes') },
  { value: 3, label: tr('n3Minutes') },
  { value: 5, label: tr('n5Minutes') },
  { value: 10, label: tr('n10Minutes') },
  { value: 15, label: tr('n15Minutes') },
  { value: 30, label: tr('n30Minutes') },
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
      title={tr('startVoting2')}
      description={open ? tr('everyoneOnTheBoardCan') : tr('everyoneWithEditAccessCan')}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{tr('cancel')}</Button>
          <Button variant="primary" icon={Vote} onClick={submit} disabled={scope === 'selected' && !picked.length}>{tr('startVoting2')}</Button>
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
        <Input label={tr('title')} placeholder={tr('whatAreWeDeciding')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        <Slider label={tr('votesPerPerson')} min={MIN_VOTES} max={MAX_VOTES} value={votes} onChange={setVotes} showValue aria-label={tr('votesPerPerson')} />
        <div className="fr-vote-hide">
          <Toggle label={tr('anonymous')} checked={anonymous} onChange={setAnonymous} />
          <small>
            {anonymous
              ? tr('nobodyYouIncludedCanEver')
              : tr('afterTheVoteTheResults')}
          </small>
        </div>
        <div className="fr-vote-hide">
          <Toggle label={tr('hideResultsUntilVotingEnds')} checked={hide || anonymous} disabled={anonymous} onChange={setHide} />
          <small>
            {anonymous
              ? tr('anAnonymousVoteIsAlways')
              : hide
                ? tr('eachBallotStaysSealedOn')
                : tr('everyoneSeesTheRunningTotals')}
          </small>
        </div>
        <div className="fr-vote-row-opt">
          <Toggle label={tr('limitVotesOnOneItem')} checked={capOn} onChange={setCapOn} />
          {capOn && (
            <Input
              size="sm"
              type="number"
              min={1}
              max={votes}
              value={String(perItem)}
              onChange={(e) => setCap(Math.max(1, Math.min(votes, Number.parseInt(e.target.value, 10) || 1)))}
              aria-label={tr('mostVotesOnePersonCan')}
              className="fr-vote-row-opt__n"
            />
          )}
        </div>
        <div className="fr-vote-row-opt">
          <span className="fr-vote-row-opt__label">
            <Timer size={15} />{' '}{tr('closeTheVoteAfter')}</span>
          <Select options={TIMER_OPTIONS} value={minutes} onChange={setMinutes} size="sm" aria-label={tr('closeTheVoteAfter')} />
        </div>
        <fieldset className="fr-vote-scope">
          <legend>{tr('whatCanPeopleVoteOn')}</legend>
          <label className={`fr-vote-scope__opt${scope === 'all' ? ' is-on' : ''}`}>
            <input type="radio" name="fr-vote-scope" checked={scope === 'all'} onChange={() => setScope('all')} />
            <span>{tr('allStickiesCardsAndShapes')}</span>
          </label>
          <label className={`fr-vote-scope__opt${scope === 'selected' ? ' is-on' : ''}${picked.length ? '' : ' is-disabled'}`}>
            <input type="radio" name="fr-vote-scope" checked={scope === 'selected'} disabled={!picked.length} onChange={() => setScope('selected')} />
            <span>{tr('onlySelectedElements')}<small>{picked.length ? tr('lengthSelected', { length: picked.length }) : tr('selectElementsOnTheBoard')}</small>
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
    if (v.canManage) items.push({ id: 'end', label: tr('endVoting'), icon: Trophy, onSelect: () => end(editor) });
    items.push({ id: 'results', label: tr('votingResults'), icon: ListOrdered, onSelect: showResults });
  } else if (session) {
    items.push(
      { id: 'results', label: tr('showResults'), icon: ListOrdered, onSelect: showResults },
      { id: 'new', label: tr('startNewSession'), icon: Vote, onSelect: () => editor.openPanel(START_DIALOG_ID) },
      { divider: true },
      { id: 'clear', label: tr('clearResults'), icon: X, danger: true, onSelect: () => clear(editor) },
    );
  } else if (v.history.length) {
    items.push(
      { id: 'new', label: tr('startVoting2'), icon: Vote, onSelect: () => editor.openPanel(START_DIALOG_ID) },
      { id: 'past', label: tr('pastVotes'), icon: History, onSelect: pastVotes },
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
      >{tr('vote')}</Button>
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
          <span className="fr-vote-ctl__total" title={tr('totalVotesInTotal', { total })}>
            {total}
          </span>
        )}
        {canVote && mine > 0 && (
          <button
            type="button"
            className="fr-vote-ctl__minus"
            aria-label={tr('removeOneOfYourVotes')}
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
            aria-label={mine ? tr('yourVotesMineAddA', { mine }) : tr('addAVoteAltClick')}
            title={tr('clickToVoteAltClick')}
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
      <div className={`fr-vote-badge${rank === 1 ? ' is-top' : ''}`} title={tr('votesVotes', { votes })}>
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
  if (closed) return tr('timeSUpNoMore');
  if (!v.canVote)
    return role === 'commenter' ? tr('youCanCommentVotingIs') : tr('viewOnlyYouCanWatch');
  if (!v.eligible.length) return tr('nothingToVoteOnYet');
  if (v.votesLeft === 0) return tr('youVeUsedAllYour');
  return tr('youHaveVotesleftVotesLeft', { votesLeft: v.votesLeft });
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
      <div className="fr-vote-bar" data-fr-interactive="" role="region" aria-label={tr('votingSession')}>
        <span className="fr-vote-bar__icon">
          <Vote size={16} />
        </span>
        <div className="fr-vote-bar__text">
          <strong>
            {session.title}
            {anonymous && <span className="fr-vote-bar__tag">{tr('anonymous')}</span>}
          </strong>
          <span className={(v.canVote && v.votesLeft === 0) || closed ? 'is-spent' : undefined}>
            {votesLeftText(v, role, closed)}
            {session.maxPerItem ? tr('atMostMaxperitemPerItem', { maxPerItem: session.maxPerItem }) : ''}
          </span>
        </div>
        {left !== null && (
          <span className={`fr-vote-bar__clock${left < 10_000 ? ' is-low' : ''}`} aria-label={tr('timeLeftToVote')} role="timer">
            <Timer size={14} />
            {clock(left)}
          </span>
        )}
        <div className="fr-vote-bar__voters">
          {people ? (
            anonymous ? (
              <span className="fr-vote-bar__muted">{tr('peopleVoted', { people })}</span>
            ) : (
              <Tooltip content={v.voters.map((p) => p.name).join(', ')} side="bottom">
                <span className="fr-vote-bar__stack">
                  <AvatarStack users={v.voters} max={4} size={24} />
                  <span>{tr('peopleVoted', { people })}</span>
                </span>
              </Tooltip>
            )
          ) : (
            <span className="fr-vote-bar__muted">{tr('noVotesYet')}</span>
          )}
        </div>
        {v.canManage && (
          <Button size="sm" variant="primary" icon={Trophy} onClick={() => end(editor)}>{tr('endVoting')}</Button>
        )}
      </div>
    );
  }

  return (
    <div className="fr-vote-bar is-results" data-fr-interactive="" role="region" aria-label={tr('votingResults')}>
      <span className="fr-vote-bar__icon">
        <Trophy size={16} />
      </span>
      <div className="fr-vote-bar__text">
        <strong>{tr('resultsTitle', { title: session.title })}</strong>
        <span>{tr('nVotesFromNPeople', { totalVotes: v.totalVotes, people })}{anonymous ? tr('anonymous2') : ''}
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
        >{tr('viewResults')}</Button>
      )}
      {canEdit && (
        <Button size="sm" variant="ghost" icon={Vote} onClick={() => editor.openPanel(START_DIALOG_ID)}>{tr('startNewSession')}</Button>
      )}
      <Tooltip content={tr('hideResults')} side="bottom">
        <button
          type="button"
          className="fr-vote-bar__close"
          aria-label={tr('hideResults')}
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
  if (!rows.length) return <p className="fr-vote-results__empty">{tr('noVotesOnItemsThat')}</p>;
  const n = Math.max(1, Math.min(rows.length, Number.parseInt(topN, 10) || 0));
  const max = rows[0].votes;
  const focus = (id: string) => {
    editor.select([id]);
    editor.zoomToFit([id], { maxZoom: 1.25, padding: PAD_PX });
  };
  return (
    <>
      <div className="fr-vote-results__top">
        <span>{tr('selectTop')}</span>
        <Input
          size="sm"
          type="number"
          min={1}
          max={rows.length}
          value={topN}
          onChange={(e) => setTopN(e.target.value)}
          aria-label={tr('numberOfTopResultsTo')}
          className="fr-vote-results__n"
        />
        <Button
          size="sm"
          onClick={() => {
            const ids = rows.slice(0, n).map((r) => r.id);
            editor.select(ids);
            editor.zoomToFit(ids, { maxZoom: 1, padding: PAD_PX });
          }}
        >{tr('select')}</Button>
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
        <ArrowLeft size={14} />{' '}{tr('allVotes')}</button>
      <div className="fr-vote-results__meta">
        <strong>{entry.session.title}</strong>
        <span>{tr('dateofNVotesNVoters', { dateOf: dateOf(entry.session.endedAt ?? entry.archivedAt), total, voters: entry.voters })}{entry.session.anonymousBallots ? tr('anonymous2') : ''}
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
        >{tr('deleteFromHistory')}</Button>
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
    body = <p className="fr-vote-results__empty">{v.history.length ? tr('noVoteRunningEarlierVotes') : tr('noVotingSessionOnThis')}</p>;
  } else if (session.active && session.anonymous) {
    body = (
      <p className="fr-vote-results__empty">{tr('ballotsAreSealedOnThe')}{session.anonymousBallots ? tr('andCountedWithoutNames') : ''}{tr('lengthPeopleHaveVotedSo', { length: v.voters.length })}</p>
    );
  } else if (!v.ranking.length) {
    body = <p className="fr-vote-results__empty">{tr('noVotesYet2')}</p>;
  } else {
    body = <RankedList editor={editor} ranking={v.ranking} />;
  }

  return (
    <div className="fr-vote-results">
      <DockHeader className="fr-vote-results__head">
        <h2 className="fr-vote-results__title">{tr('votingResults')}</h2>
      </DockHeader>
      {session && !past && (
        <div className="fr-vote-results__meta">
          <strong>{session.title}</strong>
          <span>
            {session.active ? tr('inProgress') : tr('ended')}{' '}{tr('nVotesLengthVoters', { totalVotes: v.totalVotes, length: v.voters.length })}{session.anonymousBallots ? tr('anonymous2') : ''}
          </span>
        </div>
      )}
      {body}
      {canEdit && !past && (!session || !session.active) && (
        <Button variant="secondary" icon={Vote} block onClick={() => editor.openPanel(START_DIALOG_ID)}>
          {session ? tr('startNewSession') : tr('startVoting2')}
        </Button>
      )}
      {!past && v.history.length > 0 && (
        <section className="fr-vote-history" aria-label={tr('pastVotes')}>
          <h3>
            <History size={14} />{' '}{tr('pastVotes')}</h3>
          <ul>
            {v.history.map((h) => {
              const total = h.totals.reduce((n, [, x]) => n + x, 0);
              return (
                <li key={h.session.id}>
                  <button type="button" className="fr-vote-history__row" onClick={() => useVotingUi.getState().openPast(h.session.id)}>
                    <span className="fr-vote-history__title">{h.session.title}</span>
                    <span className="fr-vote-history__meta">{tr('dateofTotalVotes', { total, dateOf: dateOf(h.session.endedAt ?? h.archivedAt) })}</span>
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
