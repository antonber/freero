import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { REPORT_REASONS, type AppealInfo, type ModerationActionKind } from '@freero/shared';
import { Button, Spinner, TextArea } from '@ui';
import { api, ApiError } from '../../api/client';
import { AuthNotice, AuthShell } from '../auth/AuthShell';
import './appeal.css';

const WHAT: Partial<Record<ModerationActionKind, (board: string) => string>> = {
  'board.disable_link': (b) => `Link sharing was turned off for ${b}.`,
  'board.take_down': (b) => `${b} was removed for review.`,
  'upload.remove': () => 'A file you uploaded was removed.',
  'user.suspend': () => 'Your account was suspended.',
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
      (e) => live && setError(e instanceof ApiError ? e.message : 'Could not reach Freero. Try again.'),
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
      setError(e instanceof ApiError ? e.message : 'Your appeal could not be sent. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!info)
    return (
      <AuthShell docTitle="Appeal" title={error ? 'That link didn’t work' : 'Loading…'}>
        {error ? <AuthNotice kind="error">{error}</AuthNotice> : <Spinner size={22} label="Loading" />}
      </AuthShell>
    );

  const board = info.boardTitle ? `“${info.boardTitle}”` : 'Your board';
  const reason = REPORT_REASONS.find((r) => r.id === info.reason)?.label ?? 'Other';
  return (
    <AuthShell docTitle="Appeal" title="Appeal a moderation decision">
      <div className="fr-appeal__decision">
        <p className="fr-appeal__what">{WHAT[info.action]?.(board) ?? 'Freero’s moderators acted on something of yours.'}</p>
        <dl className="fr-appeal__facts">
          <dt>Reason</dt>
          <dd>{reason}</dd>
          <dt>When</dt>
          <dd>{new Date(info.createdAt).toLocaleString()}</dd>
        </dl>
        {info.statement && <blockquote className="fr-appeal__statement">{info.statement}</blockquote>}
      </div>
      {info.reversed ? (
        <AuthNotice kind="success">This decision was reversed. There is nothing to appeal.</AuthNotice>
      ) : sent || info.pending ? (
        <AuthNotice kind="success">
          {sent ? 'Thanks. A moderator will review your appeal and email you the outcome.' : 'Your appeal is waiting for a moderator. We’ll email you the outcome.'}
        </AuthNotice>
      ) : (
        <>
          <TextArea
            label="Why is this a mistake?"
            value={message}
            maxLength={MAX_APPEAL}
            rows={5}
            placeholder="Explain what the content is and why it doesn’t break the rules"
            onChange={(e) => setMessage(e.target.value)}
          />
          {error && <AuthNotice kind="error">{error}</AuthNotice>}
          <Button variant="primary" size="lg" className="fr-appeal__send" onClick={send} disabled={!message.trim()} loading={busy}>
            Send appeal
          </Button>
        </>
      )}
    </AuthShell>
  );
}
