// Settings → "Problems you reported": what someone sent with "Report a problem" and where it stands.
import { useEffect, useState } from 'react';
import { MessageSquareWarning } from 'lucide-react';
import { PROBLEM_STATUS_LABEL, type OwnProblemReport } from '@freero/shared';
import { Button, Spinner } from '@ui';
import { api } from '../api/client';
import { relativeTime } from '../lib/time';
import { useProblemReport } from './ProblemReport';

import { t } from '../messages';
export function MyProblems() {
  const { open } = useProblemReport();
  const [problems, setProblems] = useState<OwnProblemReport[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api.myProblems().then(
      (r) => live && setProblems(r.problems),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="fr-problems-mine">
      {failed ? (
        <p className="fr-acct__p">{t('yourReportsCouldnTBe')}</p>
      ) : problems === null ? (
        <Spinner size={18} label={t('loadingYourReports')} />
      ) : problems.length === 0 ? (
        <p className="fr-acct__p">{t('youHavenTReportedAnything')}</p>
      ) : (
        <ul className="fr-problems-mine__list">
          {problems.map((p) => (
            <li key={p.id} className="fr-problems-mine__item">
              <span className={`fr-problems-mine__status fr-problems-mine__status--${p.status}`}>{PROBLEM_STATUS_LABEL[p.status]}</span>
              <span className="fr-problems-mine__note">{p.note}</span>
              <span className="fr-problems-mine__when" title={new Date(p.createdAt).toLocaleString()}>
                {relativeTime(p.createdAt, Date.now())}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="fr-acct-form__row">
        <Button variant="secondary" icon={MessageSquareWarning} onClick={() => open()}>{t('reportAProblem2')}</Button>
      </div>
    </div>
  );
}
