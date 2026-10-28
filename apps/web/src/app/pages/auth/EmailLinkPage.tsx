import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Spinner } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AuthNotice, AuthShell } from './AuthShell';

type Mode = 'verify' | 'change';

// Tokens are single-use: a re-run effect (StrictMode, a re-render) must not send one twice.
const inFlight = new Map<string, Promise<unknown>>();
function submitOnce(mode: Mode, token: string): Promise<unknown> {
  const key = `${mode}:${token}`;
  let p = inFlight.get(key);
  if (!p) {
    p = mode === 'verify' ? api.verifyEmail(token) : api.confirmEmailChange(token);
    inFlight.set(key, p);
  }
  return p;
}

const COPY: Record<Mode, { doc: string; working: string; done: string; doneBody: string }> = {
  verify: {
    doc: 'Confirm email',
    working: 'Confirming your email…',
    done: 'Email confirmed',
    doneBody: 'Thanks! You can now invite people and share boards.',
  },
  change: {
    doc: 'Confirm new email',
    working: 'Confirming your new address…',
    done: 'Email address changed',
    doneBody: 'Use your new address the next time you log in.',
  },
};

/** /verify-email?token= and /confirm-email?token= — the links from verification and email-change mails. */
export function EmailLinkPage({ mode }: { mode: Mode }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, refresh } = useAuth();
  const [state, setState] = useState<{ status: 'working' } | { status: 'done' } | { status: 'failed'; message: string }>(
    token ? { status: 'working' } : { status: 'failed', message: 'This link is incomplete. Open the link from the email again.' },
  );

  useEffect(() => {
    if (!token) return;
    let live = true;
    submitOnce(mode, token).then(
      () => {
        if (!live) return;
        setState({ status: 'done' });
        void refresh(); // this tab (and the others) pick up the verified / changed address
      },
      (err) => {
        if (live) setState({ status: 'failed', message: err instanceof ApiError ? err.message : 'Could not reach Freero. Try again.' });
      },
    );
    return () => {
      live = false;
    };
  }, [mode, token, refresh]);

  const copy = COPY[mode];
  if (state.status === 'working')
    return (
      <AuthShell docTitle={copy.doc} title={copy.working}>
        <Spinner size={22} label={copy.working} />
      </AuthShell>
    );
  return (
    <AuthShell docTitle={copy.doc} title={state.status === 'done' ? copy.done : 'That link didn’t work'}>
      {state.status === 'done' ? <AuthNotice kind="success">{copy.doneBody}</AuthNotice> : <AuthNotice kind="error">{state.message}</AuthNotice>}
      <p className="fr-authcard__switch">
        {user ? (
          <>
            <Link to="/app">Go to your boards</Link> · <Link to="/settings">Account settings</Link>
          </>
        ) : (
          <Link to="/login">Log in</Link>
        )}
      </p>
    </AuthShell>
  );
}
