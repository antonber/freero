// The board assistant (#1): a chat in the dock about the board as this person sees it. The server
// reads the board, asks the model and keeps the conversation (theirs alone); this panel shows it,
// zooms to the items an answer cites, and hands what it proposes to the suggestions on the board —
// nothing here writes the board: accepting a proposal is the suggestions feature's ordinary edit.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Lightbulb, Sparkles, Trash2 } from 'lucide-react';
import { ASSISTANT_LIMITS, richTextToPlain, type AssistantMessage, type BoardElement } from '@freero/shared';
import { DockHeader, describeElementType, useDock, useSuggestions, type Editor } from '@engine';
import { Button, IconButton, Modal, Spinner, TextArea } from '@ui';
import { ASSISTANT_DOCK } from './actions';
import { t } from '../messages';

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : t('theAssistantCouldnTAnswer'));

/** How a cited item reads on its chip: what it says, else its type. */
function labelOf(editor: Editor, el: BoardElement): string {
  let text = editor.getDefinition(el.type)?.toPlainText?.(el as never, editor) ?? '';
  const rec = el as unknown as Record<string, unknown>;
  if (!text && typeof rec.title === 'string') text = richTextToPlain(rec.title);
  if (!text && typeof rec.text === 'string') text = richTextToPlain(rec.text);
  text = text.replace(/\s+/g, ' ').trim();
  return text ? (text.length > 40 ? `${text.slice(0, 39)}…` : text) : describeElementType(editor, el.type).one;
}

/** Shows the cited items: selected, and the view fitted to them. */
function showItems(editor: Editor, ids: string[]) {
  const present = ids.filter((id) => editor.getElement(id));
  const b = editor.getBounds(present);
  if (!b) return;
  editor.select(present);
  editor.zoomToRect({ x: b.x - 80, y: b.y - 80, w: b.w + 160, h: b.h + 160 });
}

function Cites({ editor, ids }: { editor: Editor; ids: string[] }) {
  const items = ids.map((id) => editor.getElement(id)).filter((el): el is BoardElement => !!el);
  if (!items.length) return null;
  return (
    <div className="fr-assistant__cites" aria-label={t('itemsThisAnswerUses')}>
      {items.map((el) => (
        <button key={el.id} type="button" className="fr-assistant__cite" onClick={() => showItems(editor, [el.id])} title={t('showItOnTheBoard')}>
          {labelOf(editor, el)}
        </button>
      ))}
      {items.length > 1 && (
        <button type="button" className="fr-assistant__cite fr-assistant__cite--all" onClick={() => showItems(editor, items.map((el) => el.id))}>
          {t('showAllCount', { count: items.length })}
        </button>
      )}
    </div>
  );
}

/** What the assistant proposed: still pending (review / accept / reject on the board) or decided. */
function Proposal({ editor, m }: { editor: Editor; m: AssistantMessage }) {
  const suggestions = useSuggestions();
  const p = m.proposal!;
  const pending = suggestions.filter((s) => s.groupId === p.groupId);
  const ids = pending.map((s) => s.id);
  return (
    <div className="fr-assistant__proposal">
      <p className="fr-assistant__proposal-head">
        <Lightbulb size={14} aria-hidden />
        {t('proposedCountChanges', { count: p.count })}
      </p>
      {p.description && <p className="fr-assistant__proposal-what">{p.description}</p>}
      {pending.length ? (
        <div className="fr-assistant__proposal-actions">
          <Button size="sm" variant="primary" onClick={() => editor.runCommand('suggestions.accept', { ids })}>
            {t('acceptAll')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => editor.runCommand('suggestions.open')}>
            {t('review')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => editor.runCommand('suggestions.reject', { ids })}>
            {t('reject')}
          </Button>
        </div>
      ) : (
        <p className="fr-assistant__fine">{t('noLongerPendingAccepted')}</p>
      )}
    </div>
  );
}

function Bubble({ editor, m }: { editor: Editor; m: AssistantMessage }) {
  return (
    <li className={`fr-assistant__msg fr-assistant__msg--${m.role}`}>
      {/* Plain text only: an answer quoting the board is never markup. */}
      <p className="fr-assistant__text">{m.text}</p>
      {m.role === 'assistant' && m.cites?.length ? <Cites editor={editor} ids={m.cites} /> : null}
      {m.proposal ? <Proposal editor={editor} m={m} /> : null}
      {m.proposalError ? <p className="fr-assistant__warn">{t('couldnTProposeThatReason', { reason: m.proposalError })}</p> : null}
    </li>
  );
}

export function AssistantDock({ editor }: { editor: Editor }) {
  const assistant = editor.host.assistant;
  const [messages, setMessages] = useState<AssistantMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    assistant?.conversation().then(
      (m) => live && setMessages(m),
      (e: unknown) => live && (setMessages([]), setError(message(e))),
    );
    return () => {
      live = false;
    };
  }, [assistant]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages, asking]);

  const examples = useMemo(
    () => [t('whatDidWeDecide'), t('summariseThisBoard'), t('whatIsStillOpen'), ...(assistant?.canPropose ? [t('addThreeStickiesWithNext')] : [])],
    [assistant],
  );
  if (!assistant) return null;

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || asking) return;
    setAsking(question);
    setError(null);
    setDraft('');
    try {
      const turn = await assistant.ask({ question, ids: editor.getSelection() });
      setMessages((m) => [...(m ?? []), turn.question, turn.answer]);
      if (turn.answer.proposal) editor.host.notify(t('theAssistantProposedChanges'), 'info', { action: { label: t('review'), run: () => editor.runCommand('suggestions.open') } });
    } catch (e) {
      // The question comes back to the box, so nothing typed is lost.
      setDraft(question);
      setError(message(e));
    } finally {
      setAsking(null);
    }
  };

  const clear = async () => {
    try {
      await assistant.clear();
      setMessages([]);
    } catch (e) {
      setError(message(e));
    } finally {
      setConfirmClear(false);
    }
  };

  return (
    <div className="fr-assistant">
      <DockHeader className="fr-assistant__head">
        <h2 className="fr-assistant__title">
          <Sparkles size={16} aria-hidden /> {t('boardAssistant')}
        </h2>
        {messages?.length ? <IconButton size={32} icon={Trash2} label={t('clearThisConversation')} onClick={() => setConfirmClear(true)} /> : null}
      </DockHeader>
      {messages === null ? (
        <div className="fr-assistant__loading">
          <Spinner />
        </div>
      ) : (
        <ol className="fr-assistant__list" aria-live="polite">
          {messages.length === 0 && !asking && (
            <li className="fr-assistant__intro">
              <p>{assistant.canPropose ? t('askAboutWhatSOn') : t('askAboutWhatSOnRead')}</p>
              <div className="fr-assistant__examples">
                {examples.map((x) => (
                  <button key={x} type="button" className="fr-assistant__cite" onClick={() => void ask(x)}>
                    {x}
                  </button>
                ))}
              </div>
            </li>
          )}
          {messages.map((m) => (
            <Bubble key={m.id} editor={editor} m={m} />
          ))}
          {asking && (
            <>
              <li className="fr-assistant__msg fr-assistant__msg--user">
                <p className="fr-assistant__text">{asking}</p>
              </li>
              <li className="fr-assistant__msg fr-assistant__msg--assistant fr-assistant__msg--busy">
                <Spinner size={14} /> {t('readingTheBoard')}
              </li>
            </>
          )}
        </ol>
      )}
      <div ref={end} />
      <form
        className="fr-assistant__composer"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        {error && (
          <p className="fr-assistant__error" role="alert">
            {error}
          </p>
        )}
        <div className="fr-assistant__box">
          <TextArea
            aria-label={t('askTheAssistant')}
            placeholder={editor.getSelection().length ? t('askAboutTheSelectedItems') : t('askAboutThisBoard')}
            rows={2}
            value={draft}
            maxLength={ASSISTANT_LIMITS.question}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(draft);
              }
            }}
          />
          <IconButton type="submit" size={32} variant="solid" icon={ArrowUp} label={t('send')} disabled={!draft.trim() || !!asking} />
        </div>
        <p className="fr-assistant__fine">
          {t('theBoardAsYouSee', { provider: assistant.provider })} {assistant.canPropose ? t('itOnlyProposesChanges') : ''}
        </p>
      </form>
      {confirmClear && (
        <Modal
          open
          onClose={() => setConfirmClear(false)}
          title={t('clearThisConversation')}
          description={t('yourQuestionsAndItsAnswers')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                {t('cancel')}
              </Button>
              <Button variant="danger" onClick={() => void clear()}>
                {t('clear')}
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

/** The top bar's way in: opens and closes the assistant beside the board. */
export function AssistantButton({ editor }: { editor: Editor }) {
  const dock = useDock();
  if (!editor.host.assistant) return null;
  const open = dock === ASSISTANT_DOCK;
  return <IconButton icon={Sparkles} size={32} label={t('boardAssistant')} active={open} onClick={() => editor.openDock(open ? null : ASSISTANT_DOCK)} />;
}
