import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Spinner } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { loginPath } from '../../lib/nav';
import { AuthNotice, AuthShell } from '../auth/AuthShell';

/** /unsubscribe?token= — the link at the bottom of notification emails. Works signed out too. */
export function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user } = useAuth();
  const [state, setState] = useState<{ status: 'working' } | { status: 'done'; email: string } | { status: 'failed'; message: string }>(
    token ? { status: 'working' } : { status: 'failed', message: 'This link is incomplete. Open the link from the email again.' },
  );

  useEffect(() => {
    if (!token) return;
    let live = true;
    // Idempotent on the server, so a re-run effect (StrictMode) is harmless.
    api.unsubscribe(token).then(
      (r) => live && setState({ status: 'done', email: r.email }),
      (err) => live && setState({ status: 'failed', message: err instanceof ApiError ? err.message : 'Could not reach Freero. Try again.' }),
    );
    return () => {
      live = false;
    };
  }, [token]);

  if (state.status === 'working')
    return (
      <AuthShell docTitle="Unsubscribe" title="Unsubscribing…">
        <Spinner size={22} label="Unsubscribing" />
      </AuthShell>
    );
  return (
    <AuthShell docTitle="Unsubscribe" title={state.status === 'done' ? 'You’re unsubscribed' : 'That link didn’t work'}>
      {state.status === 'done' ? (
        <AuthNotice kind="success">
          {state.email} won’t get notification emails any more. You’ll still see mentions and replies in Freero.
        </AuthNotice>
      ) : (
        <AuthNotice kind="error">{state.message}</AuthNotice>
      )}
      <p className="fr-authcard__switch">
        {user ? <Link to="/settings#notifications">Choose which emails you get</Link> : <Link to={loginPath('/settings')}>Log in to choose which emails you get</Link>}
      </p>
    </AuthShell>
  );
}
