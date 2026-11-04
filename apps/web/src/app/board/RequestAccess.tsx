// The page for a board the signed-in user can't open: ask for access (with a role and a note), then
// wait — the page lets them in as soon as someone approves. The answer arrives as a notification,
// so the notifications socket (live on every instance) wakes the page up; a slow poll covers a
// socket that can't connect.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Lock } from 'lucide-react';
import type { AccessRequestState, Role } from '@freero/shared';
import { Button, Logo, Select, Spinner, TextArea, type SelectOption } from '@ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { loginPath } from '../lib/nav';
import { notificationsStore, retainLiveConnection } from '../notifications/store';

import { t } from '../messages';
const ROLE_OPTIONS: SelectOption<Exclude<Role, 'owner'>>[] = [
  { value: 'editor', label: t('canEdit') },
  { value: 'commenter', label: t('canComment') },
  { value: 'viewer', label: t('canView') },
];
const POLL_MS = 20_000;

/** `kind` 'doc': the same page for a doc (KAI-162) — a doc is shared and requested like a board. */
export function RequestAccess({ boardId, onGranted, kind = 'board' }: { boardId: string; onGranted: () => void; kind?: 'board' | 'doc' }) {
  const noun = kind === 'doc' ? 'doc' : 'board';
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [state, setState] = useState<AccessRequestState | null>(null);
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('editor');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const s = await api.accessRequestState(boardId);
      setState(s);
      if (s.status === 'granted') onGranted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('couldNotReachFreeroCheck'));
    }
  }, [boardId, onGranted]);

  useEffect(() => void check(), [check]);

  // While a request waits: re-check whenever a notification arrives (the answer is one) and now and then.
  const waiting = state?.status === 'pending';
  const userId = user?.id;
  useEffect(() => {
    if (!waiting || !userId) return;
    const release = retainLiveConnection(userId);
    let last = notificationsStore.getState().unread;
    const unsubscribe = notificationsStore.subscribe((s) => {
      if (s.unread !== last) void check();
      last = s.unread;
    });
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      release();
      unsubscribe();
      clearInterval(timer);
    };
  }, [waiting, userId, check]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await api.requestAccess(boardId, role, message.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('couldNotSendTheRequest'));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    try {
      setState(await api.withdrawAccessRequest(boardId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('couldNotWithdrawTheRequest'));
    } finally {
      setBusy(false);
    }
  };

  const switchAccount = async () => {
    await logout();
    navigate(loginPath(`/${noun}/${boardId}`), { replace: true });
  };

  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card fr-reqaccess">
        <Logo size={36} />
        {!state ? (
          <div className="fr-reqaccess__loading">
            <Spinner size={22} />
          </div>
        ) : state.status === 'pending' ? (
          <>
            <span className="fr-reqaccess__badge" aria-hidden>
              <Clock size={18} />
            </span>
            <h1>{t('requestSent')}</h1>
            <p>{t('theNounSOwnerHas', { noun })}</p>
            <div className="fr-reqaccess__waiting" role="status">
              <Spinner size={16} />{' '}{t('waitingForAnAnswer')}</div>
            <div className="fr-boarderror__actions">
              <Button onClick={() => navigate('/app')}>{t('backToDashboard')}</Button>
              <Button variant="ghost" loading={busy} onClick={withdraw}>{t('withdrawRequest')}</Button>
            </div>
          </>
        ) : (
          <>
            <span className="fr-reqaccess__badge" aria-hidden>
              <Lock size={18} />
            </span>
            <h1>{state.status === 'denied' ? t('yourRequestWasDeclined') : t('youNeedAccessToThis', { noun })}</h1>
            <p>
              {state.canRequest
                ? t('askForAccessAndThe')
                : (state.reason ?? t('askTheNounOwnerTo', { noun }))}
            </p>
            {user ? (
              <p className="fr-boarderror__account">{t('signedInAs')}{' '}<strong>{user.email}</strong>
              </p>
            ) : null}
            {state.canRequest ? (
              <form
                className="fr-reqaccess__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label className="fr-reqaccess__role">
                  <span>{t('accessYouNeed')}</span>
                  <Select<Exclude<Role, 'owner'>> aria-label={t('accessYouNeed')} options={ROLE_OPTIONS} value={role} onChange={setRole} width={170} />
                </label>
                <TextArea
                  aria-label={t('messageToTheOwner')}
                  placeholder={t('addANoteOptional')}
                  value={message}
                  maxLength={500}
                  rows={3}
                  onChange={(e) => setMessage(e.target.value)}
                />
                {error ? (
                  <p className="fr-reqaccess__error" role="alert">
                    {error}
                  </p>
                ) : null}
                <Button type="submit" variant="primary" size="lg" loading={busy}>{t('requestAccess')}</Button>
              </form>
            ) : error ? (
              <p className="fr-reqaccess__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="fr-boarderror__actions">
              <Button onClick={() => navigate('/app')}>{t('backToDashboard')}</Button>
              <Button variant="ghost" onClick={switchAccount}>{t('switchAccount')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
