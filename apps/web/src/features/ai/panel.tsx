// The AI dialog: pick an action, say what you want, look at a preview, insert it (one undo step).
// The server reads the board, asks the model and lays the result out; this dialog only shows the
// preview and inserts it.
import { useMemo, useState } from 'react';
import { FileText, Lightbulb, Shapes, Sparkles, Workflow } from 'lucide-react';
import { AI_LIMITS, type AiActionResponse, type AiClusterBy, type AiDiagramKind, type AiTask, type BoardElement } from '@freero/shared';
import { definePanel, type PanelProps } from '@engine';
import { Button, ElementsPreview, Modal, SegmentedControl, Select, TextArea } from '@ui';
import { AI_DIALOG, applyPreview, CATCH_UP_DIALOG, clusterable, suggestedTask } from './lib/actions';
import { CatchUpDialog } from './lib/CatchUp';
import './ai.css';

const TASKS: Array<{ value: AiTask; label: string; icon: typeof Lightbulb }> = [
  { value: 'ideas', label: 'Ideas', icon: Lightbulb },
  { value: 'cluster', label: 'Cluster', icon: Shapes },
  { value: 'summarize', label: 'Summarise', icon: FileText },
  { value: 'diagram', label: 'Diagram', icon: Workflow },
];

const DIAGRAMS: Array<{ value: AiDiagramKind; label: string }> = [
  { value: 'flowchart', label: 'Flowchart' },
  { value: 'sequence', label: 'Sequence diagram' },
  { value: 'mindmap', label: 'Mind map' },
  { value: 'class', label: 'Class diagram (UML)' },
  { value: 'er', label: 'Entity-relationship diagram' },
  { value: 'state', label: 'State diagram' },
  { value: 'orgchart', label: 'Org chart' },
  { value: 'kanban', label: 'Kanban board' },
];

const CLUSTER_BY: Array<{ value: AiClusterBy; label: string }> = [
  { value: 'theme', label: 'By theme' },
  { value: 'sentiment', label: 'By sentiment' },
];

const isTask = (v: unknown): v is AiTask => v === 'report' || TASKS.some((t) => t.value === v);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function hint(task: AiTask, selected: number, sortable: number, into: boolean, by: AiClusterBy): string {
  switch (task) {
    case 'expand':
      return 'New children for a mind-map topic.';
    case 'catchup':
      return 'A summary of what others changed, just for you.';
    case 'report':
      return 'A note beside the activity with themes, notable answers and suggested next steps, from the results everyone can see.';
    case 'ideas':
      return selected ? `Sticky notes about your prompt, with the ${plural(selected, 'selected item')} as background.` : 'Sticky notes about your prompt, next to what you’re looking at.';
    case 'cluster':
      if (sortable < 2) return 'Select two or more notes to sort them into groups.';
      return by === 'sentiment' ? `Sorts the ${plural(sortable, 'selected note')} into positive, neutral, mixed and negative.` : `Sorts the ${plural(sortable, 'selected note')} into named groups.`;
    case 'summarize':
      if (into) return 'A written summary of the meeting, added inside its frame.';
      return selected ? `A written summary of the ${plural(selected, 'selected item')}, placed beside them.` : 'A written summary of the whole board.';
    case 'diagram':
      return selected ? `A diagram built from the ${plural(selected, 'selected item')} (and your prompt).` : 'A diagram of what you describe.';
  }
}

const PLACEHOLDER: Record<AiTask, string> = {
  report: 'Optional: what to focus on, e.g. what to do next quarter',
  catchup: 'Optional: what to focus on',
  expand: 'Optional: what to focus on',
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
  const [by, setBy] = useState<AiClusterBy>(props?.by === 'sentiment' ? 'sentiment' : 'theme');
  // A summary into a frame (a meeting's, #148) and a report on an activity are asked for from their
  // own entry points: the dialog then does just that one thing.
  const into = typeof props?.into === 'string' ? props.into : undefined;
  const fixed = task === 'report' || !!into;
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
        // Sentiment groups are fixed: there is no instruction to give.
        prompt: task === 'cluster' && by === 'sentiment' ? '' : prompt.trim(),
        ...(selection.length ? { ids: (task === 'cluster' ? clusterable(selection) : selection).map((el) => el.id) } : {}),
        ...(task === 'diagram' ? { diagram } : {}),
        ...(task === 'cluster' ? { by } : {}),
        ...(into ? { into } : {}),
        target: 'preview',
        at: editor.getViewportCenter(),
      });
      if (res.target === 'suggestions') {
        // It moves other people's notes: the server proposed it instead (KAI-169). The proposal on
        // the board is the preview now, with accept / reject for whoever can edit.
        close();
        editor.runCommand('suggestions.open');
        editor.host.notify('Some of these notes are other people’s, so the AI’s sorting was added as suggestions to accept or reject.', 'info');
        return;
      }
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The AI request failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const insert = () => {
    if (!result) return;
    applyPreview(editor, result, { into });
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
          {!fixed && <SegmentedControl<AiTask> aria-label="What should AI do?" options={TASKS} value={task} onChange={(t) => setTask(t)} className="fr-ai__tasks" />}
          <p className="fr-ai__hint">{hint(task, selection.length, sortable, !!into, by)}</p>
          {task === 'cluster' && <SegmentedControl<AiClusterBy> aria-label="How to group" size="sm" options={CLUSTER_BY} value={by} onChange={setBy} />}
          {task === 'diagram' && <Select<AiDiagramKind> aria-label="Kind of diagram" size="sm" options={DIAGRAMS} value={diagram} onChange={setDiagram} />}
          {!(task === 'cluster' && by === 'sentiment') && (
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
          )}
          {error && (
            <p className="fr-ai__error" role="alert">
              {error}
            </p>
          )}
          <p className="fr-ai__fine">
            {task === 'ideas' && !selection.length ? 'Your prompt is' : task === 'report' ? 'Your prompt and the activity’s results (never who answered) are' : 'Your prompt and the board content it reads are'} sent to {ai.provider}, set up by{' '}
            {ai.source === 'workspace' ? 'your workspace’s admins' : 'this Freero server’s operator'}. Board text is passed as data, never as instructions.
          </p>
        </div>
      )}
    </Modal>
  );
}

export default [
  definePanel({
    id: AI_DIALOG,
    slot: 'dialog',
    order: 60,
    minRole: 'editor',
    Component: AiDialog,
  }),
  definePanel({ id: CATCH_UP_DIALOG, slot: 'dialog', order: 61, minRole: 'editor', Component: CatchUpDialog }),
];

