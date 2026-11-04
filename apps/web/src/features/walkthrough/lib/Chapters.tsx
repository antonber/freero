// Summary and chapters of a walkthrough (#127). Viewers read them beside the player and jump to a
// chapter; its author (or an editor) writes them — by hand ("0:00 Intro" per line), or from a draft
// the board's AI makes from the captions, edited before it is saved. Without AI, or without
// captions, chapters are still written by hand.
import { useEffect, useState } from 'react';
import { PenLine, Sparkles, X } from 'lucide-react';
import { formatWalkthroughTime, MAX_WALKTHROUGH_SUMMARY, type Walkthrough, type WalkthroughChapter } from '@freero/shared';
import { useDock, type Editor, type PanelProps } from '@engine';
import { Button, IconButton, Modal, Spinner, TextArea } from '@ui';
import { CHAPTERS_ID } from './ids';
import { updateWalkthrough, usePlayer } from './playback';
import { chapterAt, parseChapterLines } from './timeline';

import { t as tr } from '../messages';
const message = (e: unknown) => (e instanceof Error && e.message ? e.message : tr('somethingWentWrong'));
const asLines = (chapters: WalkthroughChapter[] | undefined) => (chapters ?? []).map((c) => `${formatWalkthroughTime(c.atMs)} ${c.title}`).join('\n');

/** The list viewers jump from (beside the open dock, like the comments). */
export function ChaptersList({ editor, w, t, onSeek, onClose, onEdit }: { editor: Editor; w: Walkthrough; t: number; onSeek(ms: number): void; onClose(): void; onEdit?: () => void }) {
  useDock();
  const safe = editor.getSafeArea();
  const right = Math.max(16, editor.getViewportSize().width - (safe.x + safe.w) + 12);
  const current = chapterAt(w.chapters, t);
  return (
    <section className="fr-walkthrough-comments fr-walkthrough-chapters" style={{ right }} aria-label={tr('chaptersOfThisWalkthrough')} data-fr-interactive="">
      <header className="fr-walkthrough-comments__head">
        <h2>{tr('chapters')}</h2>
        {onEdit && <IconButton icon={PenLine} label={w.chapters?.length || w.summary ? tr('editSummaryAndChapters') : tr('addSummaryAndChapters')} onClick={onEdit} />}
        <IconButton icon={X} label={tr('closeChapters')} onClick={onClose} />
      </header>
      {w.summary && <p className="fr-walkthrough-chapters__summary">{w.summary}</p>}
      <ol className="fr-walkthrough-comments__list" data-fr-scrollable="">
        {!w.chapters?.length && <li className="fr-walkthrough-comments__empty">{onEdit ? tr('noChaptersYetAddThem') : tr('noChaptersYet')}</li>}
        {w.chapters?.map((c) => (
          <li key={c.atMs}>
            <button type="button" className={`fr-walkthrough-chapters__item${current?.atMs === c.atMs ? ' is-current' : ''}`} onClick={() => onSeek(c.atMs)} aria-current={current?.atMs === c.atMs || undefined}>
              <span className="fr-walkthrough-chapters__at">{formatWalkthroughTime(c.atMs)}</span>
              <span>{c.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The author's editor for the summary and chapters, with an AI draft where AI is on. */
export function ChaptersDialog({ editor, props }: PanelProps) {
  const id = String(props?.id ?? '');
  const playing = usePlayer().walkthrough;
  const host = editor.host.walkthroughs;
  const [w, setW] = useState<Walkthrough | null>(playing?.id === id ? playing : null);
  const [summary, setSummary] = useState(w?.summary ?? '');
  const [lines, setLines] = useState(asLines(w?.chapters));
  const [busy, setBusy] = useState<'save' | 'ai' | null>(null);
  const [drafted, setDrafted] = useState(false);
  const close = () => editor.closePanel(CHAPTERS_ID);

  useEffect(() => {
    if (w || !host) return;
    host.get(id).then(
      (x) => (setW(x), setSummary(x.summary ?? ''), setLines(asLines(x.chapters))),
      (e: unknown) => editor.host.notify(message(e), 'error'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!host?.setChapters || !w) return;
    setBusy('save');
    try {
      const x = await host.setChapters(w.id, { summary: summary.trim(), chapters: parseChapterLines(lines, w.durationMs) });
      updateWalkthrough(x);
      editor.host.notify(x.chapters?.length || x.summary ? tr('summaryAndChaptersSaved') : tr('summaryAndChaptersRemoved'), 'success');
      close();
    } catch (e) {
      editor.host.notify(message(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  const draft = async () => {
    if (!host?.draftChapters || !w) return;
    setBusy('ai');
    try {
      const d = await host.draftChapters(w.id);
      setSummary(d.summary);
      setLines(asLines(d.chapters));
      setDrafted(true);
    } catch (e) {
      editor.host.notify(message(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  // Why there is no AI draft here, if there isn't (nothing at all when this server has no AI).
  const aiWhy = !w?.transcript?.length ? tr('addCaptionsFirstAiDrafts') : !editor.host.ai ? (editor.host.aiUnavailable ?? null) : null;
  const aiShown = !!editor.host.ai || !!editor.host.aiUnavailable;

  return (
    <Modal
      open
      onClose={close}
      width={540}
      title={tr('summaryAndChapters')}
      description={tr('viewersSeeTheSummaryAnd')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{tr('cancel')}</Button>
          <Button variant="primary" loading={busy === 'save'} disabled={!w || busy !== null} onClick={() => void save()}>{tr('save')}</Button>
        </>
      }
    >
      {!w ? (
        <Spinner size={20} />
      ) : (
        <div className="fr-walkthrough-captions">
          {aiShown && (
            <section className="fr-walkthrough-captions__ai">
              {aiWhy ? (
                <span>{tr('aiDraftIsnTAvailable', { aiWhy })}</span>
              ) : (
                <>
                  <Button size="sm" icon={Sparkles} loading={busy === 'ai'} disabled={busy !== null} onClick={() => void draft()}>
                    {drafted ? tr('draftAgainWithAi') : tr('draftWithAi')}
                  </Button>
                  <span>{drafted ? tr('aDraftFromTheCaptions') : tr('theCaptionsAreSentTo')}</span>
                </>
              )}
            </section>
          )}
          <TextArea label={tr('summary')} rows={3} value={summary} maxLength={MAX_WALKTHROUGH_SUMMARY} placeholder={tr('whatThisWalkthroughCoversIn')} onChange={(e) => setSummary(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <TextArea
            label={tr('chaptersOnePerLineStarting')}
            rows={6}
            value={lines}
            placeholder={tr('n000WhereWeAre')}
            onChange={(e) => setLines(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </Modal>
  );
}
