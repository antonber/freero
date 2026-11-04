// The AI dialog: pick an action, say what you want, look at a preview, insert it (one undo step).
// The server reads the board, asks the model and lays the result out; this dialog only shows the
// preview and inserts it.
import { useMemo, useState } from 'react';
import { FileText, Lightbulb, Shapes, Sparkles, Workflow } from 'lucide-react';
import { AI_LIMITS, type AiActionResponse, type AiClusterBy, type AiDiagramKind, type AiTask, type BoardElement } from '@freero/shared';
import { definePanel, type PanelProps } from '@engine';
import { Button, ElementsPreview, Modal, SegmentedControl, Select, TextArea } from '@ui';
import { AI_DIALOG, applyPreview, CATCH_UP_DIALOG, clusterable, fillNote, suggestedTask } from './lib/actions';
import { CatchUpDialog } from './lib/CatchUp';
import { t as tr } from './messages';
import './ai.css';

const TASKS: Array<{ value: AiTask; label: string; icon: typeof Lightbulb }> = [
  { value: 'ideas', label: tr('ideas'), icon: Lightbulb },
  { value: 'cluster', label: tr('cluster'), icon: Shapes },
  { value: 'summarize', label: tr('summarise2'), icon: FileText },
  { value: 'diagram', label: tr('diagram'), icon: Workflow },
];

const DIAGRAMS: Array<{ value: AiDiagramKind; label: string }> = [
  { value: 'flowchart', label: tr('flowchart') },
  { value: 'sequence', label: tr('sequenceDiagram') },
  { value: 'mindmap', label: tr('mindMap') },
  { value: 'class', label: tr('classDiagramUml') },
  { value: 'er', label: tr('entityRelationshipDiagram') },
  { value: 'state', label: tr('stateDiagram') },
  { value: 'orgchart', label: tr('orgChart') },
  { value: 'kanban', label: tr('kanbanBoard') },
];

const CLUSTER_BY: Array<{ value: AiClusterBy; label: string }> = [
  { value: 'theme', label: tr('byTheme') },
  { value: 'sentiment', label: tr('bySentiment') },
];

const isTask = (v: unknown): v is AiTask => v === 'report' || TASKS.some((t) => t.value === v);

function hint(task: AiTask, selected: number, sortable: number, into: boolean, by: AiClusterBy): string {
  switch (task) {
    case 'expand':
      return tr('newChildrenForAMind');
    case 'catchup':
      return tr('aSummaryOfWhatOthers');
    case 'report':
      return tr('aNoteBesideTheActivity');
    case 'ideas':
      return selected ? tr('stickyNotesAboutYourPrompt', { value: tr('countSelectedItem', { count: selected }) }) : tr('stickyNotesAboutYourPrompt2');
    case 'cluster':
      if (sortable < 2) return tr('selectTwoOrMoreNotes');
      return by === 'sentiment' ? tr('sortsTheValueIntoPositive', { value: tr('countSelectedNote', { count: sortable }) }) : tr('sortsTheValueIntoNamed', { value: tr('countSelectedNote', { count: sortable }) });
    case 'summarize':
      if (into) return tr('aWrittenSummaryOfThe');
      return selected ? tr('aWrittenSummaryOfThe2', { value: tr('countSelectedItem', { count: selected }) }) : tr('aWrittenSummaryOfThe3');
    case 'diagram':
      return selected ? tr('aDiagramBuiltFromThe', { value: tr('countSelectedItem', { count: selected }) }) : tr('aDiagramOfWhatYou');
  }
}

const PLACEHOLDER: Record<AiTask, string> = {
  report: tr('optionalWhatToFocusOn'),
  catchup: tr('optionalWhatToFocusOn2'),
  expand: tr('optionalWhatToFocusOn2'),
  ideas: 'e.g. Icebreakers for a remote team retro',
  cluster: tr('optionalHowToGroupThem'),
  summarize: tr('optionalWhatToFocusOn3'),
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
  const fill = typeof props?.fill === 'string' ? props.fill : undefined;
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
        editor.host.notify(tr('someOfTheseNotesAre'), 'info');
        return;
      }
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('theAiRequestFailedTry'));
    } finally {
      setBusy(false);
    }
  };

  const insert = () => {
    if (!result) return;
    if (!(fill && into && fillNote(editor, result, fill, into))) applyPreview(editor, result, { into });
    close();
    editor.host.notify(tr('addedByAiUndoTakes'), 'success');
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
            <Button variant="ghost" onClick={() => setResult(null)} disabled={busy}>{tr('back')}</Button>
            <Button variant="secondary" onClick={run} loading={busy}>{tr('tryAgain')}</Button>
            <Button variant="primary" onClick={insert} disabled={busy} data-autofocus>{tr('insert')}</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>{tr('cancel')}</Button>
            <Button variant="primary" onClick={run} disabled={blocked} loading={busy}>{tr('preview')}</Button>
          </>
        )
      }
    >
      {result ? (
        <div className="fr-ai__result">
          <ElementsPreview elements={result.snapshot?.elements ?? []} moved={moved} label={tr('previewOfTheResult')} />
          <p className="fr-ai__summary">{result.summary}</p>
          <p className="fr-ai__fine">{tr('nothingIsOnTheBoard')}</p>
        </div>
      ) : (
        <div className="fr-ai__form">
          {!fixed && <SegmentedControl<AiTask> aria-label={tr('whatShouldAiDo')} options={TASKS} value={task} onChange={(t) => setTask(t)} className="fr-ai__tasks" />}
          <p className="fr-ai__hint">{hint(task, selection.length, sortable, !!into, by)}</p>
          {task === 'cluster' && <SegmentedControl<AiClusterBy> aria-label={tr('howToGroup')} size="sm" options={CLUSTER_BY} value={by} onChange={setBy} />}
          {task === 'diagram' && <Select<AiDiagramKind> aria-label={tr('kindOfDiagram')} size="sm" options={DIAGRAMS} value={diagram} onChange={setDiagram} />}
          {!(task === 'cluster' && by === 'sentiment') && (
          <TextArea
            label={needsPrompt ? tr('prompt') : tr('promptOptional')}
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
            {task === 'ideas' && !selection.length ? tr('yourPromptIs') : task === 'report' ? tr('yourPromptAndTheActivity') : tr('yourPromptAndTheBoard')}{' '}{tr('sentToProviderSetUp', { provider: ai.provider })}{ai.source === 'workspace' ? tr('yourWorkspaceSAdmins') : tr('thisFreeroServerSOperator')}. Board text is passed as data, never as instructions.
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

