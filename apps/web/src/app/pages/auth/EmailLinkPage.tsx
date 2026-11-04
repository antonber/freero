import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Spinner } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AuthNotice, AuthShell } from './AuthShell';

import { t } from './messages';
type Mode = 'verify' | 'change' | 'cancelRecovery';

const SUBMIT: Record<Mode, (token: string) => Promise<unknown>> = {
  verify: api.verifyEmail,
  change: api.confirmEmailChange,
  cancelRecovery: api.cancelTwoFactorRecoveryByLink,
};

// Tokens are single-use: a re-run effect (StrictMode, a re-render) must not send one twice.
const inFlight = new Map<string, Promise<unknown>>();
function submitOnce(mode: Mode, token: string): Promise<unknown> {
  const key = `${mode}:${token}`;
  let p = inFlight.get(key);
  if (!p) {
    p = SUBMIT[mode](token);
    inFlight.set(key, p);
  }
  return p;
}

const COPY: Record<Mode, { doc: string; working: string; done: string; doneBody: string }> = {
  verify: {
    doc: t('confirmEmail'),
    working: t('confirmingYourEmail'),
    done: t('emailConfirmed'),
    doneBody: t('thanksYouCanNowInvite'),
  },
  change: {
    doc: t('confirmNewEmail'),
    working: t('confirmingYourNewAddress'),
    done: t('emailAddressChanged'),
    doneBody: t('useYourNewAddressThe'),
  },
  cancelRecovery: {
    doc: t('cancelAccountRecovery'),
    working: t('cancellingTheRecovery'),
    done: t('recoveryCancelled'),
    doneBody: t('twoStepVerificationStaysOn'),
  },
};

/**
 * /verify-email?token=, /confirm-email?token= and /cancel-recovery?token= — the links from
 * verification, email-change and two-step recovery mails.
 */
export function EmailLinkPage({ mode }: { mode: Mode }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, refresh } = useAuth();
  const [state, setState] = useState<{ status: 'working' } | { status: 'done' } | { status: 'failed'; message: string }>(
    token ? { status: 'working' } : { status: 'failed', message: t('thisLinkIsIncompleteOpen') },
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
        if (live) setState({ status: 'failed', message: err instanceof ApiError ? err.message : t('couldNotReachFreeroTry') });
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
    <AuthShell docTitle={copy.doc} title={state.status === 'done' ? copy.done : t('thatLinkDidnTWork')}>
      {state.status === 'done' ? <AuthNotice kind="success">{copy.doneBody}</AuthNotice> : <AuthNotice kind="error">{state.message}</AuthNotice>}
      <p className="fr-authcard__switch">
        {user ? (
          <>
            <Link to="/app">{t('goToYourBoards')}</Link> · <Link to="/settings">{t('accountSettings')}</Link>
          </>
        ) : (
          <Link to="/login">{t('logIn')}</Link>
        )}
      </p>
    </AuthShell>
  );
}
