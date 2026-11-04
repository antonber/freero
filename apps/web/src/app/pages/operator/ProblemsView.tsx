// /operator?view=problems — what people sent with "Report a problem" (bugs, broken things,
// confusion; not abuse). Newest first, by status; each card has the note, the screenshot, the
// diagnostics and the reporter's address, and the operator sets the status, an internal note and
// the issue it became. Marking one fixed tells the reporter in their inbox.
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Mail } from 'lucide-react';
import { describeDevice, PROBLEM_STATUSES, PROBLEM_STATUS_LABEL, type ProblemReportDetail, type ProblemStatus } from '@freero/shared';
import { Button, Input, Select, Spinner, TextArea, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';

import { t } from './messages';
type Filter = ProblemStatus | 'all';
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'new', label: t('new') },
  { value: 'triaged', label: t('beingLookedAt') },
  { value: 'fixed', label: t('fixed') },
  { value: 'wontfix', label: t('wonTFix') },
  { value: 'duplicate', label: t('duplicate') },
  { value: 'all', label: t('all') },
];
const STATUS_OPTIONS = PROBLEM_STATUSES.map((s) => ({ value: s, label: PROBLEM_STATUS_LABEL[s] }));
const TONE: Record<ProblemStatus, string> = { new: 'danger', triaged: 'warn', fixed: 'ok', wontfix: 'muted', duplicate: 'muted' };
const message = (e: unknown) => (e instanceof ApiError ? e.message : t('somethingWentWrongTryAgain'));

export function ProblemsView({ version }: { version: number }) {
  const notify = useToast();
  const [filter, setFilter] = useState<Filter>('new');
  const [problems, setProblems] = useState<ProblemReportDetail[] | null>(null);
  const [next, setNext] = useState<string | null>(null);

  const load = useCallback(
    (before: string | null = null) => {
      if (!before) setProblems(null);
      api.operatorProblems({ status: filter === 'all' ? null : filter, before }).then(
        (r) => {
          setProblems((cur) => (before && cur ? [...cur, ...r.problems] : r.problems));
          setNext(r.nextBefore);
        },
        (e) => {
          notify(message(e), 'error');
          setProblems([]);
        },
      );
    },
    [filter, notify],
  );
  useEffect(() => load(), [load, version]);

  return (
    <main className="fr-op__queue" aria-label={t('problemReports')}>
      <div className="fr-op-listings__bar">
        <Select<Filter> aria-label={t('status')} value={filter} onChange={setFilter} options={FILTERS} />
      </div>
      {problems === null ? (
        <Spinner size={22} label={t('loadingProblemReports')} />
      ) : problems.length === 0 ? (
        <p className="fr-op__empty">{filter === 'new' ? t('noNewProblemReports') : t('none')}</p>
      ) : (
        <>
          {problems.map((p) => (
            <ProblemCard key={p.id} problem={p} onChanged={(c) => setProblems((cur) => cur?.map((x) => (x.id === c.id ? c : x)) ?? cur)} />
          ))}
          {next ? (
            <Button variant="ghost" onClick={() => load(next)}>{t('olderReports')}</Button>
          ) : null}
        </>
      )}
    </main>
  );
}

function ProblemCard({ problem: p, onChanged }: { problem: ProblemReportDetail; onChanged: (p: ProblemReportDetail) => void }) {
  const notify = useToast();
  const [status, setStatus] = useState<ProblemStatus>(p.status);
  const [note, setNote] = useState(p.operatorNote);
  const [issueUrl, setIssueUrl] = useState(p.issueUrl ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = status !== p.status || note !== p.operatorNote || issueUrl !== (p.issueUrl ?? '');
  const d = p.diagnostics;

  const save = async () => {
    setBusy(true);
    try {
      const { problem } = await api.updateProblem(p.id, { status, operatorNote: note, issueUrl: issueUrl.trim() || null });
      onChanged(problem);
      notify(status === 'fixed' && p.status !== 'fixed' ? t('savedTheReporterWasTold') : t('saved'), 'success');
    } catch (e) {
      notify(message(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="fr-op-card fr-op-problem">
      <div className="fr-op-card__head">
        <span className={`fr-op-chip fr-op-chip--${TONE[p.status]}`}>{PROBLEM_STATUS_LABEL[p.status]}</span>
        <h2 className="fr-op-card__board">{d.path}</h2>
        <span className="fr-op-card__when" title={new Date(p.createdAt).toLocaleString()}>
          {relativeTime(p.createdAt, Date.now())}
        </span>
      </div>
      <blockquote className="fr-op-card__message">{p.note}</blockquote>
      {p.hasScreenshot ? (
        <a className="fr-op-problem__shot" href={api.problemScreenshotUrl(p.id)} target="_blank" rel="noreferrer noopener">
          <img src={api.problemScreenshotUrl(p.id)} alt={t('whatTheReporterSaw')} loading="lazy" />
        </a>
      ) : null}
      <dl className="fr-op-card__facts">
        <dt>{t('reportedBy')}</dt>
        <dd>
          {p.reporter ? (
            <>
              {p.reporter.name} &lt;{p.reporter.email}&gt;
              {p.contactOk ? (
                <a className="fr-op-problem__mail" href={`mailto:${p.reporter.email}`}>
                  <Mail size={13} aria-hidden />{' '}{t('okToContact')}</a>
              ) : (
                t('didnTAskToBe')
              )}
            </>
          ) : (
            t('anAccountThatIsGone')
          )}
        </dd>
        {d.boardId ? (
          <>
            <dt>{t('board')}</dt>
            <dd>
              <code>{d.boardId}</code>
              {d.role ? ` · ${d.role}` : ''}
            </dd>
          </>
        ) : null}
        <dt>{t('browser')}</dt>
        <dd title={d.userAgent}>
          {describeDevice(d.userAgent)} · {d.viewport.width}×{d.viewport.height} @{d.viewport.dpr}x{d.language ? ` · ${d.language}` : ''}
        </dd>
        <dt>{t('release')}</dt>
        <dd>{d.release ?? t('notSetFreeroRelease')}</dd>
        {d.events.length ? (
          <>
            <dt>{t('errors')}</dt>
            <dd>
              <ol className="fr-op-problem__events">
                {d.events.map((e, i) => (
                  <li key={i}>
                    <code>{e.message}</code>
                    {e.source ? <span className="fr-op-problem__src"> {e.source}</span> : null}
                  </li>
                ))}
              </ol>
            </dd>
          </>
        ) : null}
        {p.deleteAfter ? (
          <>
            <dt>{t('deleted')}</dt>
            <dd>{t('tolocaledatestringProblemRetentionDaysAf', { toLocaleDateString: new Date(p.deleteAfter).toLocaleDateString() })}</dd>
          </>
        ) : null}
      </dl>
      <div className="fr-op-problem__form">
        <div className="fr-op-problem__row">
          <Select<ProblemStatus> aria-label={t('status')} value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          <Input aria-label={t('linkedIssue')} placeholder={t('linkedIssueHttps')} value={issueUrl} maxLength={500} onChange={(e) => setIssueUrl(e.target.value)} />
          {p.issueUrl ? (
            <a className="fr-op-btnlink" href={p.issueUrl} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={15} aria-hidden />{' '}{t('issue')}</a>
          ) : null}
        </div>
        <TextArea aria-label={t('operatorNote')} placeholder={t('noteForOperatorsTheReporter')} rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="fr-op-card__actions">
          <Button size="sm" variant="primary" disabled={!dirty} loading={busy} onClick={save}>{t('save')}</Button>
        </div>
      </div>
    </article>
  );
}
