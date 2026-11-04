import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Spinner } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { loginPath } from '../../lib/nav';
import { AuthNotice, AuthShell } from '../auth/AuthShell';

import { t } from './messages';
/** /unsubscribe?token= — the link at the bottom of notification emails. Works signed out too. */
export function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  // The "changes on your boards" email has its own link: it stops only that email.
  const list = params.get('list') ?? undefined;
  const { user } = useAuth();
  const [state, setState] = useState<{ status: 'working' } | { status: 'done'; email: string } | { status: 'failed'; message: string }>(
    token ? { status: 'working' } : { status: 'failed', message: t('thisLinkIsIncompleteOpen') },
  );

  useEffect(() => {
    if (!token) return;
    let live = true;
    // Idempotent on the server, so a re-run effect (StrictMode) is harmless.
    api.unsubscribe(token, list).then(
      (r) => live && setState({ status: 'done', email: r.email }),
      (err) => live && setState({ status: 'failed', message: err instanceof ApiError ? err.message : t('couldNotReachFreeroTry') }),
    );
    return () => {
      live = false;
    };
  }, [token, list]);

  if (state.status === 'working')
    return (
      <AuthShell docTitle={t('unsubscribe')} title={t('unsubscribing')}>
        <Spinner size={22} label={t('unsubscribing2')} />
      </AuthShell>
    );
  return (
    <AuthShell docTitle={t('unsubscribe')} title={state.status === 'done' ? t('youReUnsubscribed') : t('thatLinkDidnTWork')}>
      {state.status === 'done' ? (
        <AuthNotice kind="success">
          {list === 'board-changes'
            ? t('emailWonTGetThe', { email: state.email })
            : t('emailWonTGetNotification', { email: state.email })}
        </AuthNotice>
      ) : (
        <AuthNotice kind="error">{state.message}</AuthNotice>
      )}
      <p className="fr-authcard__switch">
        {user ? <Link to="/settings#notifications">{t('chooseWhichEmailsYouGet')}</Link> : <Link to={loginPath('/settings')}>{t('logInToChooseWhich')}</Link>}
      </p>
    </AuthShell>
  );
}
