// Planning poker UI: the start dialog, the round bar (top-center: pick a card, who has picked,
// reveal, results with their spread, accept, next item) and the highlight on the item.
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, RotateCcw, Spade, Check, X } from 'lucide-react';
import type { BoardElement } from '@freero/shared';
import { definePanel, useCanEdit, useCollection, useElement, usePeers, usePrivateCollection, useCamera, type Editor } from '@engine';
import { AvatarStack, Button, Input, Modal, SegmentedControl, Tooltip } from '@ui';
import { accept, canManage, COLLECTION, currentItem, end, goTo, itemsToEstimate, pick, reveal, revote, start } from './lib/actions';
import { DECKS, ROUND_KEY, estimatesOf, parseCustomDeck, readRound, results, voteKey, type DeckKind, type Estimate, type EstimationValue, type Round } from './lib/model';
import { START_DIALOG_ID } from './lib/ids';
import './estimation.css';

function useRound(): { round: Round | undefined; entries: Array<[string, EstimationValue]> } {
  const entries = useCollection<EstimationValue>(COLLECTION);
  const round = useMemo(() => readRound(entries.find(([k]) => k === ROUND_KEY)?.[1]), [entries]);
  return { round, entries };
}

function titleOf(el: BoardElement | undefined): string {
  if (!el) return 'Removed item';
  if (el.type === 'card') return (el as { title?: string }).title?.trim() || 'Untitled card';
  const text = (el as { text?: string }).text ?? '';
  const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain || 'Empty sticky';
}

// ---------------------------------------------------------------- start dialog
function StartDialog({ editor }: { editor: Editor }) {
  const close = () => editor.closePanel(START_DIALOG_ID);
  const [items] = useState(() => itemsToEstimate(editor));
  const [kind, setKind] = useState<DeckKind>('fibonacci');
  const [custom, setCustom] = useState('1, 2, 4, 8, 16');
  const customValues = parseCustomDeck(custom);
  const values = kind === 'custom' ? customValues : DECKS[kind].values;
  const submit = () => {
    if (!values || !items.length) return;
    start(editor, items.map((el) => el.id), { kind, values });
    close();
  };
  const selected = editor.getSelection().length > 0;
  return (
    <Modal
      open
      onClose={close}
      title="Planning poker"
      description={`${items.length} ${items.length === 1 ? 'item' : 'items'} to estimate${selected ? ' (your selection)' : ' (every card on the board)'}, one at a time. Picks stay hidden until you reveal them.`}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" icon={Spade} onClick={submit} disabled={!values || !items.length}>
            Start estimating
          </Button>
        </>
      }
    >
      <form
        className="fr-est-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <SegmentedControl
          aria-label="Deck"
          value={kind}
          onChange={(v) => setKind(v as DeckKind)}
          options={[
            { value: 'fibonacci', label: DECKS.fibonacci.label },
            { value: 'tshirt', label: DECKS.tshirt.label },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        {kind === 'custom' && (
          <Input
            label="Values, separated by commas"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            error={customValues ? undefined : 'Give at least two values'}
            maxLength={160}
          />
        )}
        <div className="fr-est-deckpreview" aria-label="Deck preview">
          {(values ?? []).map((v) => (
            <span key={v} className="fr-est-chip">
              {v}
            </span>
          ))}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- round bar
function RoundBar({ editor }: { editor: Editor }) {
  const { round, entries } = useRound();
  const sealedEntries = usePrivateCollection<EstimationValue>(COLLECTION);
  const canEdit = useCanEdit();
  const peers = usePeers();
  const itemId = round ? currentItem(round) : null;
  const item = useElement(itemId ?? '');
  if (!round || !itemId) return null;
  const manage = canManage(editor, round);
  const estimates = estimatesOf(entries, round, itemId);
  const voters = estimates.map((e) => ({ id: e.userId, name: e.userName, color: e.userColor }));
  const here = new Set([editor.user.id, ...peers.map((p) => p.user.id)]).size;
  const mine = (sealedEntries.find(([k]) => k === voteKey(round.id, itemId, editor.user.id))?.[1] as Estimate | undefined)?.value ?? null;
  const res = round.revealed ? results(estimates, round.deck) : null;
  const isCard = item?.type === 'card';

  return (
    <div className="fr-est-bar" data-fr-interactive="" role="region" aria-label="Planning poker">
      <div className="fr-est-bar__row">
        <span className="fr-est-bar__icon">
          <Spade size={16} />
        </span>
        <div className="fr-est-bar__text">
          <strong>{titleOf(item)}</strong>
          <span>
            Item {round.index + 1} of {round.itemIds.length} · {round.revealed ? 'revealed' : `${estimates.length} of ${here} picked`}
            {manage ? '' : ` · ${round.startedByName} reveals`}
          </span>
        </div>
        {voters.length > 0 && !round.revealed && (
          <Tooltip content={voters.map((v) => v.name).join(', ')} side="bottom">
            <span className="fr-est-bar__voters">
              <AvatarStack users={voters} max={5} size={24} />
            </span>
          </Tooltip>
        )}
        {manage && (
          <span className="fr-est-bar__nav">
            <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label="Previous item" disabled={round.index === 0} onClick={() => goTo(editor, round.index - 1)} />
            <Button
              size="sm"
              variant="ghost"
              icon={ChevronRight}
              aria-label="Next item"
              disabled={round.index >= round.itemIds.length - 1}
              onClick={() => goTo(editor, round.index + 1)}
            />
          </span>
        )}
        {manage && !round.revealed && (
          <Button size="sm" variant="primary" icon={Eye} disabled={!estimates.length} onClick={() => reveal(editor)}>
            Reveal
          </Button>
        )}
        {manage && (
          <Tooltip content="End planning poker" side="bottom">
            <button type="button" className="fr-est-bar__close" aria-label="End planning poker" onClick={() => end(editor)}>
              <X size={16} />
            </button>
          </Tooltip>
        )}
      </div>

      {!round.revealed && (
        <div className="fr-est-bar__deck" role="group" aria-label="Your estimate">
          {canEdit ? (
            round.deck.values.map((v) => (
              <button key={v} type="button" className={`fr-est-card${mine === v ? ' is-mine' : ''}`} aria-pressed={mine === v} onClick={() => pick(editor, v)}>
                {v}
              </button>
            ))
          ) : (
            <span className="fr-est-bar__muted">Only people who can edit the board pick cards.</span>
          )}
        </div>
      )}

      {res && (
        <div className="fr-est-bar__results">
          <div className="fr-est-dist" aria-label="Estimates">
            {res.distribution.map((d) => (
              <Tooltip key={d.value} content={d.voters.map((v) => v.userName).join(', ')} side="bottom">
                <span className={`fr-est-dist__col${d.value === res.suggestion ? ' is-top' : ''}`}>
                  <span className="fr-est-dist__bar" style={{ height: 6 + (22 * d.voters.length) / Math.max(...res.distribution.map((x) => x.voters.length)) }} />
                  <span className="fr-est-dist__value">{d.value}</span>
                  <span className="fr-est-dist__count">×{d.voters.length}</span>
                </span>
              </Tooltip>
            ))}
            {!res.distribution.length && <span className="fr-est-bar__muted">Nobody picked a card.</span>}
          </div>
          <div className="fr-est-stats">
            {res.consensus ? (
              <strong className="fr-est-stats__agree">Everyone agrees</strong>
            ) : (
              <>
                {res.average !== null && <span>Average {res.average}</span>}
                {res.median !== null && <span>Median {res.median}</span>}
                {res.min !== null && res.max !== null && res.min !== res.max && (
                  <span>
                    Spread {res.min}–{res.max}
                  </span>
                )}
                {res.outliers.length > 0 && (
                  <span className="fr-est-stats__outliers">
                    Hear from {estimates.filter((e) => res.outliers.includes(e.userId)).map((e) => e.userName).join(', ')}
                  </span>
                )}
              </>
            )}
          </div>
          {manage && (
            <div className="fr-est-actions">
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => revote(editor)}>
                Re-vote
              </Button>
              {isCard && res.suggestion && <AcceptButtons editor={editor} round={round} suggestion={res.suggestion} />}
              {!isCard && <span className="fr-est-bar__muted">Estimates are saved on cards.</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AcceptButtons({ editor, round, suggestion }: { editor: Editor; round: Round; suggestion: string }) {
  const [other, setOther] = useState(false);
  const last = round.index >= round.itemIds.length - 1;
  const save = (v: string) => {
    accept(editor, v);
    setOther(false);
    if (!last) goTo(editor, round.index + 1);
  };
  if (other)
    return (
      <span className="fr-est-other" role="group" aria-label="Save another value">
        {round.deck.values
          .filter((v) => v !== '?')
          .map((v) => (
            <button key={v} type="button" className="fr-est-card is-small" onClick={() => save(v)}>
              {v}
            </button>
          ))}
      </span>
    );
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOther(true)}>
        Other value
      </Button>
      <Button size="sm" variant="primary" icon={Check} onClick={() => save(suggestion)}>
        Save {suggestion}
        {last ? '' : ' & next'}
      </Button>
    </>
  );
}

// ---------------------------------------------------------------- highlight on the board
function ItemHighlight() {
  const { round } = useRound();
  const { zoom } = useCamera();
  const itemId = round ? currentItem(round) : null;
  const el = useElement(itemId ?? '');
  if (!round || !el) return null;
  return (
    <div
      className="fr-est-highlight"
      style={{
        width: el.w,
        height: el.h,
        transform: `translate(${el.x}px, ${el.y}px) rotate(${el.rotation || 0}deg)`,
        ['--fr-est-px' as string]: `${1 / Math.max(zoom, 0.05)}px`,
      }}
      aria-hidden
    />
  );
}

export default [
  definePanel({ id: 'estimation.bar', slot: 'top-center', order: 45, Component: RoundBar }),
  definePanel({ id: 'estimation.highlight', slot: 'world-overlay', order: 40, Component: ItemHighlight }),
  definePanel({ id: START_DIALOG_ID, slot: 'dialog', order: 45, Component: StartDialog }),
];
