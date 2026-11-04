// Route /embed/connect/:id[?readonly=1][&site=<host>] — the sign-in popup of a board embedded on
// another site (#2). It is Freero's own page in its own window (first-party: the person's session
// is here, which the frame never gets), opened by the embed frame. Once the person confirms, it
// mints a token for THIS board acting for this session and posts it to `window.opener` with
// targetOrigin = Freero's own origin — only a Freero frame can receive it — then closes.
//
// It never navigates itself (that would lose its opener): signing in happens in a new tab
// (/login?next=/embed/signed-in), which tells this window through the app's session channel.
// The server keeps window.opener for this path only (Cross-Origin-Opener-Policy unsafe-none) and
// never lets it be framed.
//
// With ?teams=1 it is the Microsoft Teams tab's sign-in (app/teams): Teams opened it in its own
// sign-in window (authentication.authenticate), and the token goes back through the Teams
// JavaScript library (authentication.notifySuccess) — which talks to Teams' own origins only —
// never by postMessage to an opener. Teams' desktop and mobile apps run that window apart from any
// browser, so there (?client= other than web) signing in happens in this window itself.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { EMBED_NO_ACCESS, type BoardSummary, type EmbedConnectMessage, type Role, type TeamsSignInResult } from '@freero/shared';
import { Button, Logo, Spinner } from '@ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { RequestAccess } from '../board/RequestAccess';
import { loginPath } from '../lib/nav';
import { t as tr } from '../messages';
import '../board/BoardPage.css';

const ROLE_TEXT: Record<Role, string> = { owner: tr('editYouOwnIt'), editor: 'edit', commenter: tr('viewAndComment'), viewer: 'view' };

const tellOpener = (msg: EmbedConnectMessage) => window.opener?.postMessage(msg, window.location.origin);

/** In Teams' sign-in window: whether Teams answered (null while asking). */
function useTeamsWindow(enabled: boolean): boolean | null {
  const [ok, setOk] = useState<boolean | null>(enabled ? null : false);
  useEffect(() => {
    if (!enabled) return;
    void import('../teams/teamsSdk').then(({ connectTeams }) => connectTeams()).then((t) => setOk(t !== null));
  }, [enabled]);
  return ok;
}

export default function EmbedConnectPage() {
  const { id = '' } = useParams();
  const params = new URLSearchParams(window.location.search);
  const readonly = params.get('readonly') === '1';
  const teams = params.get('teams') === '1';
  const signInHere = teams && params.get('client') !== 'web';
  const site = teams ? 'Microsoft Teams' : params.get('site')?.slice(0, 120) || 'this page';
  const teamsReady = useTeamsWindow(teams);
  const { user, loading, refresh } = useAuth();
  const [board, setBoard] = useState<BoardSummary | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const granted = useCallback(() => setAttempt((n) => n + 1), []);
  const opened = teams ? teamsReady === true : typeof window.opener === 'object' && window.opener !== null;
  const tell = useCallback(
    (msg: EmbedConnectMessage) => {
      if (!teams) return tellOpener(msg);
      // Teams: only the token goes back; without access the person stays here to ask for it.
      if (msg.freeroEmbedConnect !== 'token') return;
      const result: TeamsSignInResult = { kind: 'token', boardId: msg.boardId, token: msg.token, expiresAt: msg.expiresAt };
      void import('../teams/teamsSdk').then(({ finishTeamsSignIn }) => finishTeamsSignIn(JSON.stringify(result)));
    },
    [teams],
  );

  // Signed in in another tab (password or provider): pick the session up when this window gets focus back.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setNoAccess(false);
    api.getBoard(id).then(
      ({ board }) => !cancelled && setBoard(board),
      (e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 403 && e.code !== 'link_password_required') {
          setNoAccess(true);
          tell({ freeroEmbedConnect: 'no-access', boardId: id });
        } else setError(e instanceof ApiError ? e.message : tr('couldNotReachFreero'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, userId, attempt, tell]);

  const allow = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { token, expiresAt } = await api.publicEmbedToken(id, readonly);
      tell({ freeroEmbedConnect: 'token', boardId: id, token, expiresAt });
      if (!teams) window.close(); // Teams closes its own window
    } catch (e) {
      if (e instanceof ApiError && e.code === EMBED_NO_ACCESS) setNoAccess(true);
      else setError(e instanceof ApiError ? e.message : tr('couldNotReachFreero'));
    } finally {
      setBusy(false);
    }
  }, [id, readonly, tell, teams]);

  if (teams && teamsReady === null) return <Card title={tr('signingIn')}><Spinner size={22} label={tr('connectingToTeams')} /></Card>;
  if (!opened)
    return (
      <Card title={tr('openThisFromTheEmbedded')}>
        <p>{tr('thisWindowSignsYouIn')}</p>
      </Card>
    );
  if (loading) return <Card title={tr('signingIn')}><Spinner size={22} label={tr('checkingYourSession')} /></Card>;
  if (!user)
    return (
      <Card title={tr('signInToFreero')}>
        <p>{tr('signInToSeeThis2', { site })}{signInHere ? '' : ' A new tab opens; come back here when you’re signed in.'}</p>
        <div className="fr-boarderror__actions">
          <Button variant="primary" onClick={() => signInFromWindow('login', signInHere)}>{tr('signIn')}</Button>
          <Button onClick={() => signInFromWindow('signup', signInHere)}>{tr('createAnAccount')}</Button>
        </div>
      </Card>
    );
  if (noAccess) return <RequestAccess boardId={id} onGranted={granted} />;
  if (error)
    return (
      <Card title={tr('couldnTSignInHere')}>
        <p>{error}</p>
      </Card>
    );
  if (!board) return <Card title={tr('signingIn')}><Spinner size={22} label={tr('openingTheBoard')} /></Card>;
  const role: Role = readonly ? 'viewer' : board.role;
  return (
    <Card title={tr('showValueOnSite', { value: board.title || tr('untitledBoard'), site })}>
      <p>{tr('youLlSeeItThere', { name: user.name, role_text: ROLE_TEXT[role] })}{role !== 'viewer' && !teams ? tr('changesStartOnlyAfterYou') : ''}{' '}{tr('signingOutOfFreeroEnds')}</p>
      <div className="fr-boarderror__actions">
        <Button variant="primary" loading={busy} onClick={() => void allow()}>{tr('continue')}</Button>
        <Button onClick={() => window.close()}>{tr('cancel')}</Button>
      </div>
    </Card>
  );
}

/**
 * Signing in from a sign-in window: in a new tab, which wakes this window when it's done (it keeps
 * its opener), or — `here`, in Teams' apps, which run the window apart from any browser — in this
 * window itself, coming back to this page afterwards.
 */
export function signInFromWindow(page: 'login' | 'signup', here: boolean): void {
  if (here) window.location.assign(loginPath(window.location.pathname + window.location.search, page));
  else window.open(loginPath('/embed/signed-in', page), '_blank');
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card">
        <Logo size={32} />
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}
