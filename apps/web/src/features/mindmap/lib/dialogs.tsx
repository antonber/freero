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

const KINDS: Array<{ value: AiExpandKind; label: string }> = [
  { value: 'ideas', label: 'Ideas' },
  { value: 'questions', label: 'Questions' },
  { value: 'subtopics', label: 'Sub-topics' },
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
      setError(e instanceof Error && e.message ? e.message : 'The AI request failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const picked = (items ?? []).filter((_, i) => !off.has(i));
  const add = () => {
    const cur = editor.getElement<MindmapElement>(id);
    if (!cur || cur.type !== 'mindmap' || cur.locked) {
      editor.host.notify('That topic is gone or locked.', 'error');
      return;
    }
    insertOutline(editor, picked.map((text) => ({ text })), { x: cur.x, y: cur.y }, id);
    close();
    editor.host.notify(`Added ${picked.length} under “${plain(cur.text) || 'the topic'}”. Undo takes them back.`, 'success');
  };

  if (!ai) return null;
  return (
    <Modal
      open
      onClose={close}
      title={
        <span className="fr-mm-dialog__title">
          <Sparkles size={18} aria-hidden /> Expand “{node ? plain(node.text) || 'Topic' : 'Topic'}”
        </span>
      }
      width={480}
      footer={
        items ? (
          <>
            <Button variant="ghost" onClick={() => setItems(null)} disabled={busy}>
              Back
            </Button>
            <Button variant="secondary" onClick={() => void run()} loading={busy}>
              Try again
            </Button>
            <Button variant="primary" onClick={add} disabled={busy || !picked.length} data-autofocus>
              Add {picked.length}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void run()} disabled={!node} loading={busy}>
              Suggest
            </Button>
          </>
        )
      }
    >
      {items ? (
        <div className="fr-mm-dialog">
          <ul className="fr-mm-dialog__list" aria-label="Suggested children">
            {items.map((t, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={!off.has(i)} onChange={() => setOff((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))} />
                  {t}
                </label>
              </li>
            ))}
          </ul>
          <p className="fr-mm-dialog__fine">Nothing is on the board yet. Add puts the ticked ones under the topic, as one step you can undo. AI can be wrong: check them first.</p>
        </div>
      ) : (
        <div className="fr-mm-dialog">
          <SegmentedControl<AiExpandKind> aria-label="What to add" options={KINDS} value={kind} onChange={setKind} />
          <TextArea label="Focus (optional)" rows={2} value={prompt} placeholder="e.g. for a small team on a budget" onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          {error && (
            <p className="fr-mm-dialog__error" role="alert">
              {error}
            </p>
          )}
          <p className="fr-mm-dialog__fine">
            The topic, the path to it and what is under it already are sent to {ai.provider}, set up by{' '}
            {ai.source === 'workspace' ? 'your workspace’s admins' : 'this Freero server’s operator'}. Board text is passed as data, never as instructions.
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
    if (made.length) editor.host.notify(`Made a mind map of ${notes.length} notes. Undo puts the notes back.`, 'success');
    else editor.host.notify('These notes can’t become a mind map right now.', 'error');
  };
  return (
    <Modal
      open
      onClose={close}
      title={
        <span className="fr-mm-dialog__title">
          <Network size={18} aria-hidden /> Make a mind map
        </span>
      }
      description="The note you pick becomes the central topic; the others become its ideas. One undo puts the notes back."
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={make} disabled={notes.length < 2 || !root} data-autofocus>
            Make mind map
          </Button>
        </>
      }
    >
      <fieldset className="fr-mm-dialog__list fr-mm-dialog__roots">
        <legend>Central topic</legend>
        {notes.map((n) => (
          <label key={n.id}>
            <input type="radio" name="fr-mm-root" checked={root === n.id} onChange={() => setRoot(n.id)} />
            {plain(n.text) || '(empty note)'}
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}
