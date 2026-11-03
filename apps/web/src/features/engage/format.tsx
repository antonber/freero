// Running a live activity from the format toolbar (owners and editors): set it up, reveal sealed
// results, close / reopen answers, the link (and QR code) people answer through, show it full
// screen, start over.
import { CircleCheck, Eye, EyeOff, FileDown, ListRestart, Maximize2, MessageSquare, MessageSquareOff, Play, QrCode, RotateCcw, Settings2, SkipForward } from 'lucide-react';
import type { ActivityElement, ActivityResults } from '@freero/shared';
import { defineFormat, richTextToPlain, type Editor } from '@engine';
import { IconButton } from '@ui';
import { LINK_DIALOG, RESULTS, SETTINGS_DIALOG, STAGE_DIALOG, resultsCsv } from './lib/activity';

async function run(editor: Editor, fn: () => Promise<unknown>, done?: string) {
  try {
    await fn();
    if (done) editor.host.notify(done, 'success');
  } catch (e) {
    editor.host.notify(e instanceof Error ? e.message : 'Something went wrong', 'error');
  }
}

/** Saves the results everyone sees as a CSV file (#147), where the board lets this person export. */
function downloadCsv(editor: Editor, a: ActivityElement) {
  const r = editor.collection<ActivityResults>(RESULTS).get(a.id);
  const blob = new Blob(['\ufeff' + resultsCsv(a, r)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const name = richTextToPlain(a.question).trim().replace(/[\\/:*?"<>|]+/g, '').slice(0, 60) || 'Activity';
  link.href = url;
  link.download = `${name} results.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  editor.host.reportExport?.('csv');
}

/** Running a quiz (#147): open the first question, show its answer, move on. The server keeps the clock. */
function QuizControls({ editor, a }: { editor: Editor; a: ActivityElement }) {
  const runQuiz = editor.host.engage?.runQuiz;
  if (!runQuiz) return null;
  const total = a.questions?.length ?? 0;
  const step = a.quiz?.step ?? -1;
  const go = (body: { step: number } | { showAnswer: true }, done?: string) => void run(editor, () => runQuiz(a.id, body), done);
  return (
    <>
      {step < 0 ? <IconButton icon={Play} label="Start the quiz (open question 1)" disabled={!total} onClick={() => go({ step: 0 })} /> : null}
      {step >= 0 && !a.quiz?.showAnswer ? <IconButton icon={CircleCheck} label="Show the right answer" onClick={() => go({ showAnswer: true })} /> : null}
      {step >= 0 && a.quiz?.showAnswer && step < total - 1 ? <IconButton icon={SkipForward} label={`Next question (${step + 2} of ${total})`} onClick={() => go({ step: step + 1 })} /> : null}
      {step >= 0 ? <IconButton icon={ListRestart} label="Back to the start of the quiz" onClick={() => go({ step: -1 })} /> : null}
    </>
  );
}

function Controls({ editor, a }: { editor: Editor; a: ActivityElement }) {
  const engage = editor.host.engage;
  const quiz = a.kind === 'quiz';
  return (
    <>
      <IconButton icon={Settings2} label="Set up activity" onClick={() => editor.openPanel(SETTINGS_DIALOG, { id: a.id })} />
      {quiz ? <QuizControls editor={editor} a={a} /> : null}
      {engage && a.results === 'reveal' ? (
        <>
          <IconButton
            icon={Eye}
            label={quiz ? 'Reveal the leaderboard to everyone' : 'Reveal results to everyone'}
            onClick={() => void run(editor, () => engage.reveal(a.id, true), quiz ? 'Leaderboard revealed' : 'Results revealed')}
          />
          <IconButton icon={EyeOff} label={quiz ? 'Hide the leaderboard again' : 'Hide results again'} onClick={() => void run(editor, () => engage.reveal(a.id, false))} />
        </>
      ) : null}
      <IconButton
        icon={a.closed ? MessageSquare : MessageSquareOff}
        label={a.closed ? 'Reopen answers' : 'Close answers'}
        onClick={() => editor.update<ActivityElement>(a.id, { closed: !a.closed })}
      />
      <IconButton icon={QrCode} label="Answer link and QR code (phones)" onClick={() => editor.openPanel(LINK_DIALOG, { id: a.id })} />
      <IconButton icon={Maximize2} label="Show full screen" onClick={() => editor.openPanel(STAGE_DIALOG, { id: a.id })} />
      {editor.host.board.canExport !== false ? <IconButton icon={FileDown} label="Download results (CSV)" onClick={() => downloadCsv(editor, a)} /> : null}
      {engage ? (
        <IconButton
          icon={RotateCcw}
          label="Start over (delete every answer)"
          onClick={() => {
            if (window.confirm('Delete every answer to this activity? This can’t be undone.')) void run(editor, () => engage.clear(a.id), 'Answers cleared');
          }}
        />
      ) : null}
    </>
  );
}

export default defineFormat({
  id: 'engage.format',
  order: 50,
  appliesTo: (selection) => selection.length === 1 && selection[0].type === 'activity',
  Component: ({ editor, selection }) => <Controls editor={editor} a={selection[0] as ActivityElement} />,
});
