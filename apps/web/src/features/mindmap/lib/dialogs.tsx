// The mind map's two dialogs (#134):
//   Expand with AI — 3 to 7 ideas, questions or sub-topics for one topic, from the board's AI
//     provider (Host.ai: the server reads the topic, its path and its children). Previewed as a
//     list to pick from; the picked ones are added under the topic in one undo step.
//   Make a mind map — pick which of the selected sticky notes is the central topic.
import { useMemo, useState } from 'react';
import { Network, Sparkles } from 'lucide-react';
import { richTextToPlain, type AiExpandKind, type MindmapElement } from '@freero/shared';
import type { PanelProps } from '@engine';
import { Button, Modal, SegmentedControl, TextArea } from '@ui';
import { insertOutline } from './actions';
import { EXPAND_DIALOG, FROM_STICKIES_DIALOG } from './constants';
import { mapFromStickies, stickiesOf } from './fromStickies';

import { t as tr } from '../messages';
const KINDS: Array<{ value: AiExpandKind; label: string }> = [
  { value: 'ideas', label: tr('ideas') },
  { value: 'questions', label: tr('questions') },
  { value: 'subtopics', label: tr('subTopics') },
];

const plain = (html: string) => richTextToPlain(html).replace(/\s+/g, ' ').trim();

export function ExpandDialog({ editor, props }: PanelProps) {
  const ai = editor.host.ai;
  const id = typeof props?.id === 'string' ? props.id : '';
  const node = editor.getElement<MindmapElement>(id);
  const [kind, setKind] = useState<AiExpandKind>('ideas');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<string[] | null>(null);
  const [off, setOff] = useState<Set<number>>(new Set());
  const close = () => editor.closePanel(EXPAND_DIALOG);

  const run = async () => {
    if (!ai || !node) return;
    setBusy(true);
    setError(null);
    try {
      const res = await ai.run({ task: 'expand', expand: kind, ids: [id], prompt: prompt.trim(), target: 'preview' });
      setItems(res.children ?? []);
      setOff(new Set());
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : tr('theAiRequestFailedTry'));
    } finally {
      setBusy(false);
    }
  };

  const picked = (items ?? []).filter((_, i) => !off.has(i));
  const add = () => {
    const cur = editor.getElement<MindmapElement>(id);
    if (!cur || cur.type !== 'mindmap' || cur.locked) {
      editor.host.notify(tr('thatTopicIsGoneOr'), 'error');
      return;
    }
    insertOutline(editor, picked.map((text) => ({ text })), { x: cur.x, y: cur.y }, id);
    close();
    editor.host.notify(tr('addedLengthUnderValueUndo', { length: picked.length, value: plain(cur.text) || tr('theTopic') }), 'success');
  };

  if (!ai) return null;
  return (
    <Modal
      open
      onClose={close}
      title={
        <span className="fr-mm-dialog__title">
          <Sparkles size={18} aria-hidden />{' '}{tr('expand')}{node ? plain(node.text) || tr('topic') : tr('topic')}”
        </span>
      }
      width={480}
      footer={
        items ? (
          <>
            <Button variant="ghost" onClick={() => setItems(null)} disabled={busy}>{tr('back')}</Button>
            <Button variant="secondary" onClick={() => void run()} loading={busy}>{tr('tryAgain')}</Button>
            <Button variant="primary" onClick={add} disabled={busy || !picked.length} data-autofocus>{tr('addLength', { length: picked.length })}</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>{tr('cancel')}</Button>
            <Button variant="primary" onClick={() => void run()} disabled={!node} loading={busy}>{tr('suggest')}</Button>
          </>
        )
      }
    >
      {items ? (
        <div className="fr-mm-dialog">
          <ul className="fr-mm-dialog__list" aria-label={tr('suggestedChildren')}>
            {items.map((t, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={!off.has(i)} onChange={() => setOff((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))} />
                  {t}
                </label>
              </li>
            ))}
          </ul>
          <p className="fr-mm-dialog__fine">{tr('nothingIsOnTheBoard')}</p>
        </div>
      ) : (
        <div className="fr-mm-dialog">
          <SegmentedControl<AiExpandKind> aria-label={tr('whatToAdd')} options={KINDS} value={kind} onChange={setKind} />
          <TextArea label={tr('focusOptional')} rows={2} value={prompt} placeholder={tr('eGForASmall')} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          {error && (
            <p className="fr-mm-dialog__error" role="alert">
              {error}
            </p>
          )}
          <p className="fr-mm-dialog__fine">{tr('theTopicThePathTo', { provider: ai.provider })}{ai.source === 'workspace' ? tr('yourWorkspaceSAdmins') : tr('thisFreeroServerSOperator')}. Board text is passed as data, never as instructions.
          </p>
        </div>
      )}
    </Modal>
  );
}

export function FromStickiesDialog({ editor, props }: PanelProps) {
  const ids = useMemo(() => (Array.isArray(props?.ids) ? (props.ids as unknown[]).filter((v): v is string => typeof v === 'string') : []), [props]);
  const notes = useMemo(() => stickiesOf(editor, ids).sort((a, b) => a.y - b.y || a.x - b.x), [editor, ids]);
  const [root, setRoot] = useState(notes[0]?.id ?? '');
  const close = () => editor.closePanel(FROM_STICKIES_DIALOG);
  const make = () => {
    const made = mapFromStickies(editor, root, notes.map((n) => n.id));
    close();
    if (made.length) editor.host.notify(tr('madeAMindMapOf', { length: notes.length }), 'success');
    else editor.host.notify(tr('theseNotesCanTBecome'), 'error');
  };
  return (
    <Modal
      open
      onClose={close}
      title={
        <span className="fr-mm-dialog__title">
          <Network size={18} aria-hidden />{' '}{tr('makeAMindMap2')}</span>
      }
      description="The note you pick becomes the central topic; the others become its ideas. One undo puts the notes back."
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{tr('cancel')}</Button>
          <Button variant="primary" onClick={make} disabled={notes.length < 2 || !root} data-autofocus>{tr('makeMindMap')}</Button>
        </>
      }
    >
      <fieldset className="fr-mm-dialog__list fr-mm-dialog__roots">
        <legend>{tr('centralTopic')}</legend>
        {notes.map((n) => (
          <label key={n.id}>
            <input type="radio" name="fr-mm-root" checked={root === n.id} onChange={() => setRoot(n.id)} />
            {plain(n.text) || tr('emptyNote')}
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}
