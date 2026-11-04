import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { REPORT_REASONS, type AppealInfo, type ModerationActionKind } from '@freero/shared';
import { Button, Spinner, TextArea } from '@ui';
import { api, ApiError } from '../../api/client';
import { AuthNotice, AuthShell } from '../auth/AuthShell';
import { t } from './messages';
import './appeal.css';

const WHAT: Partial<Record<ModerationActionKind, (board: string) => string>> = {
  'board.disable_link': (b) => t('linkSharingWasTurnedOff', { b }),
  'board.take_down': (b) => `${b} was removed for review.`,
  'upload.remove': () => t('aFileYouUploadedWas'),
  'user.suspend': () => t('yourAccountWasSuspended'),
};

const MAX_APPEAL = 4000;

/**
 * /appeal?t= — the signed link in a moderation notice: what was decided and why, and a form to
 * ask for another review. Works signed out (a suspended account can't sign in).
 */
export function AppealPage() {
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const [info, setInfo] = useState<AppealInfo | null>(null);
  const [error, setError] = useState<string | null>(token ? null : 'This link is incomplete. Open the link from the email again.');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!token) return;
    let live = true;
    api.appeal(token).then(
      (r) => live && setInfo(r.appeal),
      (e) => live && setError(e instanceof ApiError ? e.message : t('couldNotReachFreeroTry')),
    );
    return () => {
      live = false;
    };
  }, [token]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.submitAppeal(token, message.trim());
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('yourAppealCouldNotBe'));
    } finally {
      setBusy(false);
    }
  };

  if (!info)
    return (
      <AuthShell docTitle={t('appeal')} title={error ? t('thatLinkDidnTWork') : t('loading')}>
        {error ? <AuthNotice kind="error">{error}</AuthNotice> : <Spinner size={22} label={t('loading2')} />}
      </AuthShell>
    );

  const board = info.boardTitle ? `“${info.boardTitle}”` : t('yourBoard');
  const reason = REPORT_REASONS.find((r) => r.id === info.reason)?.label ?? 'Other';
  return (
    <AuthShell docTitle={t('appeal')} title={t('appealAModerationDecision')}>
      <div className="fr-appeal__decision">
        <p className="fr-appeal__what">{WHAT[info.action]?.(board) ?? t('freeroSModeratorsActedOn')}</p>
        <dl className="fr-appeal__facts">
          <dt>{t('reason')}</dt>
          <dd>{reason}</dd>
          <dt>{t('when')}</dt>
          <dd>{new Date(info.createdAt).toLocaleString()}</dd>
        </dl>
        {info.statement && <blockquote className="fr-appeal__statement">{info.statement}</blockquote>}
      </div>
      {info.reversed ? (
        <AuthNotice kind="success">{t('thisDecisionWasReversedThere')}</AuthNotice>
      ) : sent || info.pending ? (
        <AuthNotice kind="success">
          {sent ? t('thanksAModeratorWillReview') : t('yourAppealIsWaitingFor')}
        </AuthNotice>
      ) : (
        <>
          <TextArea
            label={t('whyIsThisAMistake')}
            value={message}
            maxLength={MAX_APPEAL}
            rows={5}
            placeholder={t('explainWhatTheContentIs')}
            onChange={(e) => setMessage(e.target.value)}
          />
          {error && <AuthNotice kind="error">{error}</AuthNotice>}
          <Button variant="primary" size="lg" className="fr-appeal__send" onClick={send} disabled={!message.trim()} loading={busy}>{t('sendAppeal')}</Button>
        </>
      )}
    </AuthShell>
  );
}
