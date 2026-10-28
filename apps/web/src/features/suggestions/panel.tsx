// Suggestions on the board (KAI-169): proposed items drawn as translucent ghosts with the
// proposer's badge, accept / reject per item and per group right there, the review list in the
// dock, and a count in the top bar while any wait. Only owners and editors ever receive
// suggestions (the server sends the editors layer to nobody else), so nothing here renders for
// anyone else; the buttons hide while a facilitator's lock makes this user a commenter.
import { memo, useMemo } from 'react';
import { AlertTriangle, Check, Lightbulb, Trash2, X } from 'lucide-react';
import {
  DockHeader,
  ElementPreview,
  definePanel,
  useCamera,
  useCanEdit,
  useDock,
  useElement,
  useSuggestions,
  type Editor,
  type PanelProps,
  type Suggestion,
} from '@engine';
import { Button, IconButton } from '@ui';
import {
  PANEL_ID,
  accept,
  actionLabel,
  boundsOf,
  focus,
  groupSuggestions,
  previewElement,
  reject,
  staleLabel,
  textOf,
  unionOf,
  type SuggestionGroup,
} from './lib/model';
import './suggestions.css';

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

// ---------------------------------------------------------------------------
// On the board (world-overlay)
// ---------------------------------------------------------------------------
const Ghost = memo(function Ghost({ editor, s, zoom, controls }: { editor: Editor; s: Suggestion; zoom: number; controls: boolean }) {
  // The item it changes, live: the ghost follows edits made meanwhile (and turns stale).
  useElement(s.targetId);
  const el = previewElement(editor, s);
  if (!el) return null;
  const stale = s.state !== 'ready';
  const k = 1 / zoom;
  return (
    <div className={`fr-sg-ghost fr-sg-ghost--${s.op}${stale ? ' is-stale' : ''}`}>
      {s.op !== 'delete' && <ElementPreview element={el} />}
      {/* A line's box is a sliver around it: the line itself is the ghost. */}
      {el.type !== 'connector' && (
        <div className="fr-sg-ghost__box" style={{ transform: `translate(${el.x}px, ${el.y}px)${el.rotation ? ` rotate(${el.rotation}deg)` : ''}`, width: el.w, height: el.h }} />
      )}
      {controls && (
        <div className="fr-sg-anchor" style={{ transform: `translate(${el.x + el.w}px, ${el.y}px) scale(${k})` }}>
          <div className="fr-sg-item" data-fr-interactive="" data-fr-keep-clear="" onPointerDown={stop}>
            {stale && (
              <span className="fr-sg-item__stale" title={staleLabel(s)}>
                <AlertTriangle size={13} aria-hidden />
              </span>
            )}
            <button type="button" className="fr-sg-item__btn fr-sg-item__btn--ok" aria-label={`Accept: ${actionLabel(editor, s)}`} title="Accept" onClick={() => accept(editor, [s.id])}>
              <Check size={14} strokeWidth={2.6} />
            </button>
            <button type="button" className="fr-sg-item__btn" aria-label={`Reject: ${actionLabel(editor, s)}`} title="Reject" onClick={() => reject(editor, [s.id])}>
              <X size={14} strokeWidth={2.6} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

function GroupBadge({ editor, group, zoom, canEdit }: { editor: Editor; group: SuggestionGroup; zoom: number; canEdit: boolean }) {
  const r = unionOf(group.items.map((s) => boundsOf(editor, s)));
  if (!r) return null;
  const n = group.items.length;
  return (
    <div className="fr-sg-anchor" style={{ transform: `translate(${r.x}px, ${r.y}px) scale(${1 / zoom})` }}>
      <div className="fr-sg-badge" data-fr-interactive="" data-fr-keep-clear="" onPointerDown={stop}>
        <button type="button" className="fr-sg-badge__who" onClick={() => editor.openDock(PANEL_ID)} title={group.description || 'Review in Suggestions'}>
          <Lightbulb size={14} aria-hidden />
          <span>
            <strong>{group.by}</strong> suggests {n === 1 ? '1 change' : `${n} changes`}
          </span>
        </button>
        {canEdit && (
          <>
            <button type="button" className="fr-sg-badge__btn fr-sg-badge__btn--ok" onClick={() => accept(editor, group.items.map((s) => s.id))}>
              <Check size={14} strokeWidth={2.6} aria-hidden />
              {n === 1 ? 'Accept' : 'Accept all'}
            </button>
            <button type="button" className="fr-sg-badge__btn" aria-label={n === 1 ? 'Reject' : 'Reject all'} title={n === 1 ? 'Reject' : 'Reject all'} onClick={() => reject(editor, group.items.map((s) => s.id))}>
              <X size={14} strokeWidth={2.6} aria-hidden />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SuggestionsWorld({ editor }: PanelProps) {
  const list = useSuggestions();
  const { zoom } = useCamera();
  const canEdit = useCanEdit();
  const groups = useMemo(() => groupSuggestions(list), [list]);
  if (!list.length) return null;
  // Per-item buttons only where they fit: close enough, and not a wall of them.
  const itemControls = canEdit && zoom >= 0.45;
  return (
    <div className="fr-sg-world">
      {list.map((s) => (
        <Ghost key={s.id} editor={editor} s={s} zoom={zoom} controls={itemControls && groups.find((g) => g.id === s.groupId)!.items.length > 1} />
      ))}
      {groups.map((g) => (
        <GroupBadge key={g.id} editor={editor} group={g} zoom={zoom} canEdit={canEdit} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The review list (dock)
// ---------------------------------------------------------------------------
function Row({ editor, s, canEdit }: { editor: Editor; s: Suggestion; canEdit: boolean }) {
  const target = useElement(s.targetId);
  const el = previewElement(editor, s);
  const now = textOf(editor, el);
  const was = s.op === 'update' && target && ('text' in (s.patch ?? {}) || 'title' in (s.patch ?? {})) ? textOf(editor, target) : '';
  const stale = s.state !== 'ready';
  return (
    <li className={`fr-sg-row${stale ? ' is-stale' : ''}`}>
      <button type="button" className="fr-sg-row__main" onClick={() => focus(editor, [s])}>
        <span className="fr-sg-row__what">{actionLabel(editor, s)}</span>
        {was && was !== now ? (
          <span className="fr-sg-row__text">
            <del>{was}</del> <ins>{now}</ins>
          </span>
        ) : now ? (
          <span className={`fr-sg-row__text${s.op === 'delete' ? ' is-deleted' : ''}`}>{now}</span>
        ) : null}
        {stale && (
          <span className="fr-sg-row__stale">
            <AlertTriangle size={12} aria-hidden /> {staleLabel(s)}
          </span>
        )}
      </button>
      {canEdit && (
        <span className="fr-sg-row__actions">
          {stale ? (
            <Button size="sm" variant="secondary" disabled={s.state === 'gone' && s.op !== 'create'} onClick={() => editor.acceptSuggestions([s.id], { force: true })}>
              Apply anyway
            </Button>
          ) : (
            <IconButton icon={Check} size={32} label="Accept" onClick={() => accept(editor, [s.id])} />
          )}
          <IconButton icon={stale ? Trash2 : X} size={32} label={stale ? 'Drop' : 'Reject'} onClick={() => reject(editor, [s.id])} />
        </span>
      )}
    </li>
  );
}

function Group({ editor, group, canEdit }: { editor: Editor; group: SuggestionGroup; canEdit: boolean }) {
  const ids = group.items.map((s) => s.id);
  return (
    <section className="fr-sg-group" aria-label={`Suggestions by ${group.by}`}>
      <header className="fr-sg-group__head">
        <span className="fr-sg-group__icon">
          <Lightbulb size={15} aria-hidden />
        </span>
        <button type="button" className="fr-sg-group__who" onClick={() => focus(editor, group.items)}>
          <strong>{group.by}</strong>
          <span>
            {group.items.length === 1 ? '1 change' : `${group.items.length} changes`}
            {group.stale ? ` · ${group.stale} out of date` : ''}
          </span>
        </button>
      </header>
      {group.description && <p className="fr-sg-group__desc">{group.description}</p>}
      {canEdit && (
        <div className="fr-sg-group__actions">
          <Button size="sm" variant="primary" icon={Check} onClick={() => accept(editor, ids)}>
            Accept all
          </Button>
          <Button size="sm" variant="ghost" icon={X} onClick={() => reject(editor, ids)}>
            Reject all
          </Button>
        </div>
      )}
      <ul className="fr-sg-group__list">
        {group.items.map((s) => (
          <Row key={s.id} editor={editor} s={s} canEdit={canEdit} />
        ))}
      </ul>
    </section>
  );
}

function SuggestionsDock({ editor }: PanelProps) {
  const list = useSuggestions();
  const canEdit = useCanEdit();
  const groups = useMemo(() => groupSuggestions(list), [list]);
  return (
    <div className="fr-sg-dock">
      <DockHeader className="fr-sg-dock__head">
        <h2>Suggestions</h2>
      </DockHeader>
      {groups.length ? (
        groups.map((g) => <Group key={g.id} editor={editor} group={g} canEdit={canEdit} />)
      ) : (
        <div className="fr-sg-dock__empty">
          <Lightbulb size={22} aria-hidden />
          <p>No suggestions waiting. When an app or an AI action proposes changes instead of making them, they show up here for you to accept or reject.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The top bar count
// ---------------------------------------------------------------------------
function SuggestionsButton({ editor }: PanelProps) {
  const list = useSuggestions();
  const dock = useDock();
  if (!list.length) return null;
  const n = list.length;
  return (
    <Button
      variant="ghost"
      icon={Lightbulb}
      className={`fr-sg-topbar${dock === PANEL_ID ? ' is-open' : ''}`}
      aria-label={`${n} suggestion${n === 1 ? '' : 's'} to review`}
      onClick={() => editor.openDock(dock === PANEL_ID ? null : PANEL_ID)}
    >
      {n}
    </Button>
  );
}

export default [
  definePanel({ id: 'suggestions.world', slot: 'world-overlay', order: 60, Component: SuggestionsWorld }),
  definePanel({ id: 'suggestions.button', slot: 'topbar-right', order: 25, Component: SuggestionsButton }),
  definePanel({ id: PANEL_ID, slot: 'dock-right', order: 52, Component: SuggestionsDock }),
];
