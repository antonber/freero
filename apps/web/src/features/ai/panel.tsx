// The AI dialog: pick an action, say what you want, look at a preview, insert it (one undo step).
// The server reads the board, asks the model and lays the result out; this dialog only shows the
// preview and inserts it.
import { useMemo, useState } from 'react';
import { FileText, Lightbulb, Shapes, Sparkles, Workflow } from 'lucide-react';
import { AI_LIMITS, type AiActionResponse, type AiDiagramKind, type AiTask, type BoardElement } from '@freero/shared';
import { definePanel, type PanelProps } from '@engine';
import { Button, ElementsPreview, Modal, SegmentedControl, TextArea } from '@ui';
import { AI_DIALOG, applyPreview, clusterable, suggestedTask } from './lib/actions';
import './ai.css';

const TASKS: Array<{ value: AiTask; label: string; icon: typeof Lightbulb }> = [
  { value: 'ideas', label: 'Ideas', icon: Lightbulb },
  { value: 'cluster', label: 'Cluster', icon: Shapes },
  { value: 'summarize', label: 'Summarise', icon: FileText },
  { value: 'diagram', label: 'Diagram', icon: Workflow },
];

const DIAGRAMS: Array<{ value: AiDiagramKind; label: string }> = [
  { value: 'flowchart', label: 'Flowchart' },
  { value: 'sequence', label: 'Sequence' },
  { value: 'mindmap', label: 'Mind map' },
];

const isTask = (v: unknown): v is AiTask => TASKS.some((t) => t.value === v);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function hint(task: AiTask, selected: number, sortable: number): string {
  switch (task) {
    case 'ideas':
      return selected ? `Sticky notes about your prompt, with the ${plural(selected, 'selected item')} as background.` : 'Sticky notes about your prompt, next to what you’re looking at.';
    case 'cluster':
      return sortable >= 2 ? `Sorts the ${plural(sortable, 'selected note')} into named groups.` : 'Select two or more notes to sort them into groups.';
    case 'summarize':
      return selected ? `A written summary of the ${plural(selected, 'selected item')}, placed beside them.` : 'A written summary of the whole board.';
    case 'diagram':
      return selected ? `A diagram built from the ${plural(selected, 'selected item')} (and your prompt).` : 'A diagram of what you describe.';
  }
}

const PLACEHOLDER: Record<AiTask, string> = {
  ideas: 'e.g. Icebreakers for a remote team retro',
  cluster: 'Optional: how to group them, e.g. by customer pain',
  summarize: 'Optional: what to focus on, e.g. decisions and owners',
  diagram: 'e.g. How a support ticket goes from new to resolved',
};

function AiDialog({ editor, props }: PanelProps) {
  const ai = editor.host.ai;
  const ids = useMemo(() => (Array.isArray(props?.ids) ? (props.ids as unknown[]).filter((v): v is string => typeof v === 'string') : []), [props]);
  const selection = useMemo(() => ids.map((id) => editor.getElement(id)).filter((el): el is BoardElement => !!el), [editor, ids]);
  const sortable = clusterable(selection).length;
  const [task, setTask] = useState<AiTask>(isTask(props?.task) ? props.task : suggestedTask(selection));
  const [diagram, setDiagram] = useState<AiDiagramKind>('flowchart');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiActionResponse | null>(null);
  const close = () => editor.closePanel(AI_DIALOG);

  const needsPrompt = (task === 'ideas' || task === 'diagram') && !selection.length;
  const blocked = (task === 'cluster' && sortable < 2) || (needsPrompt && !prompt.trim());

  const run = async () => {
    if (!ai || blocked) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await ai.run({
        task,
        prompt: prompt.trim(),
        ...(selection.length ? { ids: (task === 'cluster' ? clusterable(selection) : selection).map((el) => el.id) } : {}),
        ...(task === 'diagram' ? { diagram } : {}),
        target: 'preview',
        at: editor.getViewportCenter(),
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The AI request failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const insert = () => {
    if (!result) return;
    applyPreview(editor, result);
    close();
    editor.host.notify('Added by AI. Undo takes it back.', 'success');
  };

  const moved = useMemo(
    () =>
      (result?.moves ?? [])
        .map((m) => {
          const el = editor.getElement(m.id);
          return el ? ({ ...el, x: m.x, y: m.y } as BoardElement) : null;
        })
        .filter((el): el is BoardElement => !!el),
    [editor, result],
  );

  if (!ai) return null;
  return (
    <Modal
      open
      onClose={close}
      title={
        <span className="fr-ai__title">
          <Sparkles size={18} aria-hidden /> AI
        </span>
      }
      width={result ? 640 : 520}
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={() => setResult(null)} disabled={busy}>
              Back
            </Button>
            <Button variant="secondary" onClick={run} loading={busy}>
              Try again
            </Button>
            <Button variant="primary" onClick={insert} disabled={busy} data-autofocus>
              Insert
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={run} disabled={blocked} loading={busy}>
              Preview
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="fr-ai__result">
          <ElementsPreview elements={result.snapshot?.elements ?? []} moved={moved} label="Preview of the result" />
          <p className="fr-ai__summary">{result.summary}</p>
          <p className="fr-ai__fine">
            Nothing is on the board yet. Insert adds it as one step you can undo. AI can be wrong: check it before you rely on it.
          </p>
        </div>
      ) : (
        <div className="fr-ai__form">
          <SegmentedControl<AiTask> aria-label="What should AI do?" options={TASKS} value={task} onChange={(t) => setTask(t)} className="fr-ai__tasks" />
          <p className="fr-ai__hint">{hint(task, selection.length, sortable)}</p>
          {task === 'diagram' && <SegmentedControl<AiDiagramKind> aria-label="Kind of diagram" size="sm" options={DIAGRAMS} value={diagram} onChange={setDiagram} />}
          <TextArea
            label={needsPrompt ? 'Prompt' : 'Prompt (optional)'}
            value={prompt}
            rows={3}
            maxLength={AI_LIMITS.prompt}
            placeholder={PLACEHOLDER[task]}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void run();
            }}
          />
          {error && (
            <p className="fr-ai__error" role="alert">
              {error}
            </p>
          )}
          <p className="fr-ai__fine">
            {task === 'ideas' && !selection.length ? 'Your prompt is' : 'Your prompt and the board content it reads are'} sent to {ai.provider}, set up by{' '}
            {ai.source === 'workspace' ? 'your workspace’s admins' : 'this Freero server’s operator'}. Board text is passed as data, never as instructions.
          </p>
        </div>
      )}
    </Modal>
  );
}

export default definePanel({
  id: AI_DIALOG,
  slot: 'dialog',
  order: 60,
  minRole: 'editor',
  Component: AiDialog,
});

