// Running a live activity from the format toolbar (owners and editors): set it up, reveal sealed
// results, close / reopen answers, the link (and QR code) people answer through, show it full
// screen, start over.
import { CircleCheck, Eye, EyeOff, FileDown, ListRestart, Maximize2, MessageSquare, MessageSquareOff, Play, QrCode, RotateCcw, Settings2, SkipForward } from 'lucide-react';
import type { ActivityElement, ActivityResults } from '@freero/shared';
import { defineFormat, richTextToPlain, type Editor } from '@engine';
import { IconButton } from '@ui';
import { LINK_DIALOG, RESULTS, SETTINGS_DIALOG, STAGE_DIALOG, resultsCsv } from './lib/activity';

import { t } from './messages';
async function run(editor: Editor, fn: () => Promise<unknown>, done?: string) {
  try {
    await fn();
    if (done) editor.host.notify(done, 'success');
  } catch (e) {
    editor.host.notify(e instanceof Error ? e.message : t('somethingWentWrong'), 'error');
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
      {step < 0 ? <IconButton icon={Play} label={t('startTheQuizOpenQuestion')} disabled={!total} onClick={() => go({ step: 0 })} /> : null}
      {step >= 0 && !a.quiz?.showAnswer ? <IconButton icon={CircleCheck} label={t('showTheRightAnswer')} onClick={() => go({ showAnswer: true })} /> : null}
      {step >= 0 && a.quiz?.showAnswer && step < total - 1 ? <IconButton icon={SkipForward} label={t('nextQuestionValueOfTotal', { value: step + 2, total })} onClick={() => go({ step: step + 1 })} /> : null}
      {step >= 0 ? <IconButton icon={ListRestart} label={t('backToTheStartOf')} onClick={() => go({ step: -1 })} /> : null}
    </>
  );
}

function Controls({ editor, a }: { editor: Editor; a: ActivityElement }) {
  const engage = editor.host.engage;
  const quiz = a.kind === 'quiz';
  return (
    <>
      <IconButton icon={Settings2} label={t('setUpActivity')} onClick={() => editor.openPanel(SETTINGS_DIALOG, { id: a.id })} />
      {quiz ? <QuizControls editor={editor} a={a} /> : null}
      {engage && a.results === 'reveal' ? (
        <>
          <IconButton
            icon={Eye}
            label={quiz ? t('revealTheLeaderboardToEveryone') : t('revealResultsToEveryone')}
            onClick={() => void run(editor, () => engage.reveal(a.id, true), quiz ? t('leaderboardRevealed') : t('resultsRevealed'))}
          />
          <IconButton icon={EyeOff} label={quiz ? t('hideTheLeaderboardAgain') : t('hideResultsAgain')} onClick={() => void run(editor, () => engage.reveal(a.id, false))} />
        </>
      ) : null}
      <IconButton
        icon={a.closed ? MessageSquare : MessageSquareOff}
        label={a.closed ? t('reopenAnswers') : t('closeAnswers')}
        onClick={() => editor.update<ActivityElement>(a.id, { closed: !a.closed })}
      />
      <IconButton icon={QrCode} label={t('answerLinkAndQrCode2')} onClick={() => editor.openPanel(LINK_DIALOG, { id: a.id })} />
      <IconButton icon={Maximize2} label={t('showFullScreen')} onClick={() => editor.openPanel(STAGE_DIALOG, { id: a.id })} />
      {editor.host.board.canExport !== false ? <IconButton icon={FileDown} label={t('downloadResultsCsv')} onClick={() => downloadCsv(editor, a)} /> : null}
      {engage ? (
        <IconButton
          icon={RotateCcw}
          label={t('startOverDeleteEveryAnswer')}
          onClick={() => {
            if (window.confirm(t('deleteEveryAnswerToThis'))) void run(editor, () => engage.clear(a.id), t('answersCleared'));
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
