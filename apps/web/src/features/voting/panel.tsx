import { memo, useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { ListOrdered, Minus, Plus, Trophy, Vote, X } from 'lucide-react';
import type { BoardElement } from '@freero/shared';
import { definePanel, useCanEdit, useDock, type Editor, type Rect } from '@engine';
import { AvatarStack, Button, Input, Menu, Modal, Slider, Toggle, Tooltip, type MenuItem } from '@ui';
import { MAX_VOTES, MIN_VOTES } from './lib/voting';
import { RESULTS_PANEL_ID, previewOf, useVoting, useVotingUi, type VotingView } from './lib/state';
import { clear, end, start, unvote, vote } from './lib/actions';
import './voting.css';

// ---------------------------------------------------------------------------
// Start dialog
// ---------------------------------------------------------------------------
type Scope = 'all' | 'selected';

function StartDialog({ editor }: { editor: Editor }) {
  const open = useVotingUi((s) => s.dialogOpen);
  const close = useVotingUi((s) => s.closeDialog);
  const [title, setTitle] = useState('');
  const [votes, setVotes] = useState(3);
  const [hide, setHide] = useState(true);
  const [scope, setScope] = useState<Scope>('all');
  const [picked, setPicked] = useState<string[]>([]);

  // Snapshot the selection when the dialog opens (the dialog itself never changes it).
  useEffect(() => {
    if (!open) return;
    const sel = editor.getSelection().filter((id) => {
      const t = editor.getElement(id)?.type;
      return t && t !== 'connector' && t !== 'pen';
    });
    setPicked(sel);
    setScope(sel.length > 1 ? 'selected' : 'all');
  }, [open, editor]);

  const submit = () => {
    if (scope === 'selected' && !picked.length) return;
    start(editor, { title, votesPerUser: votes, hideResults: hide, elementIds: scope === 'selected' ? picked : null });
    useVotingUi.getState().hide(null);
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Start voting"
      description="Everyone with edit access can vote. Votes are private until you choose to show them."
      width={460}
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
        <Toggle label="Hide results until voting ends" checked={hide} onChange={setHide} />
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
  if (session?.active) {
    if (v.canManage) items.push({ id: 'end', label: 'End voting', icon: Trophy, onSelect: () => end(editor) });
    items.push({ id: 'results', label: 'Voting results', icon: ListOrdered, onSelect: showResults });
  } else if (session) {
    items.push(
      { id: 'results', label: 'Show results', icon: ListOrdered, onSelect: showResults },
      { id: 'new', label: 'Start new session', icon: Vote, onSelect: () => useVotingUi.getState().openDialog() },
      { divider: true },
      { id: 'clear', label: 'Clear results', icon: X, danger: true, onSelect: () => clear(editor) },
    );
  }

  return (
    <>
      <Button
        ref={ref}
        variant="ghost"
        icon={Vote}
        className={`fr-vote-btn${session?.active ? ' is-live' : ''}`}
        aria-haspopup={session ? 'menu' : 'dialog'}
        aria-expanded={menu}
        onClick={() => (session ? setMenu((o) => !o) : useVotingUi.getState().openDialog())}
      >
        Vote
      </Button>
      <Menu open={menu} onClose={() => setMenu(false)} anchor={ref.current} side="bottom" align="end" items={items} />
      <StartDialog editor={editor} />
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
function votesLeftText(v: VotingView): string {
  if (!v.canVote) return 'View only: you can watch, but not vote';
  if (!v.eligible.length) return 'Nothing to vote on yet';
  if (v.votesLeft === 0) return "You've used all your votes";
  return `You have ${v.votesLeft} vote${v.votesLeft === 1 ? '' : 's'} left`;
}

function SessionBar({ editor }: { editor: Editor }) {
  const v = useVoting();
  const canEdit = useCanEdit();
  const dock = useDock();
  const { session } = v;
  if (!session || !v.visible) return null;
  const people = v.voters.length;

  if (session.active) {
    return (
      <div className="fr-vote-bar" data-fr-interactive="" role="region" aria-label="Voting session">
        <span className="fr-vote-bar__icon">
          <Vote size={16} />
        </span>
        <div className="fr-vote-bar__text">
          <strong>{session.title}</strong>
          <span className={v.canVote && v.votesLeft === 0 ? 'is-spent' : undefined}>{votesLeftText(v)}</span>
        </div>
        <div className="fr-vote-bar__voters">
          {people ? (
            <Tooltip content={v.voters.map((p) => p.name).join(', ')} side="bottom">
              <span className="fr-vote-bar__stack">
                <AvatarStack users={v.voters} max={4} size={24} />
                <span>{people} voted</span>
              </span>
            </Tooltip>
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
        </span>
      </div>
      {dock !== RESULTS_PANEL_ID && (
        <Button size="sm" icon={ListOrdered} onClick={() => editor.openDock(RESULTS_PANEL_ID)}>
          View results
        </Button>
      )}
      {canEdit && (
        <Button size="sm" variant="ghost" icon={Vote} onClick={() => useVotingUi.getState().openDialog()}>
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
/** Width the right dock covers (panel + margins). zoomToRect doesn't know about the dock. */
const DOCK_COVER_PX = 384;
const PAD_PX = 72;

/** Fits `rect` into the part of the viewport left of the open dock, never zooming past maxZoom. */
function revealBesideDock(editor: Editor, rect: Rect, maxZoom: number) {
  const vp = editor.getViewportSize();
  const usableW = Math.max(200, vp.width - DOCK_COVER_PX);
  const zoom = Math.min(maxZoom, (usableW - PAD_PX * 2) / Math.max(rect.w, 1), (vp.height - PAD_PX * 2) / Math.max(rect.h, 1));
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  editor.setCamera({ x: cx - usableW / 2 / zoom, y: cy - vp.height / 2 / zoom, zoom }, { animate: true });
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
function ResultsPanel({ editor }: { editor: Editor }) {
  const v = useVoting();
  const canEdit = useCanEdit();
  const [topN, setTopN] = useState('3');
  const { session } = v;

  const focus = (id: string) => {
    const el = editor.getElement(id);
    if (!el) return;
    editor.select([id]);
    revealBesideDock(editor, aabb(el), 1.25);
  };
  const n = Math.max(1, Math.min(v.ranking.length, Number.parseInt(topN, 10) || 0));

  let body;
  if (!session) {
    body = <p className="fr-vote-results__empty">No voting session on this board yet.</p>;
  } else if (session.active && session.anonymous) {
    body = (
      <p className="fr-vote-results__empty">
        Results are hidden until voting ends. {v.voters.length} {v.voters.length === 1 ? 'person has' : 'people have'} voted so far.
      </p>
    );
  } else if (!v.ranking.length) {
    body = <p className="fr-vote-results__empty">No votes yet.</p>;
  } else {
    const max = v.ranking[0].votes;
    body = (
      <>
        <div className="fr-vote-results__top">
          <span>Select top</span>
          <Input
            size="sm"
            type="number"
            min={1}
            max={v.ranking.length}
            value={topN}
            onChange={(e) => setTopN(e.target.value)}
            aria-label="Number of top results to select"
            className="fr-vote-results__n"
          />
          <Button
            size="sm"
            onClick={() => {
              const ids = v.ranking.slice(0, n).map((r) => r.id);
              editor.select(ids);
              const b = editor.getBounds(ids);
              if (b) revealBesideDock(editor, b, 1);
            }}
          >
            Select
          </Button>
        </div>
        <ol className="fr-vote-results__list">
          {v.ranking.map((r) => {
            const el = editor.getElement(r.id);
            if (!el) return null;
            return (
              <li key={r.id}>
                <button type="button" className="fr-vote-row" onClick={() => focus(r.id)}>
                  <span className={`fr-vote-row__rank${r.rank === 1 ? ' is-top' : ''}`}>{r.rank}</span>
                  <span className="fr-vote-row__main">
                    <span className="fr-vote-row__text">{previewOf(editor, el)}</span>
                    <span className="fr-vote-row__bar">
                      <span style={{ width: `${(r.votes / max) * 100}%` }} />
                    </span>
                  </span>
                  <span className="fr-vote-row__votes">{r.votes}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </>
    );
  }

  return (
    <div className="fr-vote-results">
      <h2 className="fr-vote-results__title">Voting results</h2>
      {session && (
        <div className="fr-vote-results__meta">
          <strong>{session.title}</strong>
          <span>
            {session.active ? 'In progress' : 'Ended'} · {v.totalVotes} vote{v.totalVotes === 1 ? '' : 's'} · {v.voters.length}{' '}
            {v.voters.length === 1 ? 'voter' : 'voters'}
          </span>
        </div>
      )}
      {body}
      {canEdit && session && !session.active && (
        <Button variant="secondary" icon={Vote} block onClick={() => useVotingUi.getState().openDialog()}>
          Start new session
        </Button>
      )}
    </div>
  );
}

export default [
  definePanel({ id: 'voting.button', slot: 'topbar-right', order: 30, Component: VoteButton }),
  definePanel({ id: 'voting.world', slot: 'world-overlay', order: 50, Component: VotingWorld }),
  definePanel({ id: 'voting.bar', slot: 'screen-overlay', order: 50, Component: SessionBar }),
  definePanel({ id: RESULTS_PANEL_ID, slot: 'dock-right', order: 50, Component: ResultsPanel }),
];
