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
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { EMBED_NO_ACCESS, type BoardSummary, type EmbedConnectMessage, type Role } from '@freero/shared';
import { Button, Logo, Spinner } from '@ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { RequestAccess } from '../board/RequestAccess';
import { loginPath } from '../lib/nav';
import '../board/BoardPage.css';

const ROLE_TEXT: Record<Role, string> = { owner: 'edit (you own it)', editor: 'edit', commenter: 'view and comment', viewer: 'view' };

const tell = (msg: EmbedConnectMessage) => window.opener?.postMessage(msg, window.location.origin);

export default function EmbedConnectPage() {
  const { id = '' } = useParams();
  const params = new URLSearchParams(window.location.search);
  const readonly = params.get('readonly') === '1';
  const site = params.get('site')?.slice(0, 120) || 'this page';
  const { user, loading, refresh } = useAuth();
  const [board, setBoard] = useState<BoardSummary | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const granted = useCallback(() => setAttempt((n) => n + 1), []);
  const opened = typeof window.opener === 'object' && window.opener !== null;

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
        } else setError(e instanceof ApiError ? e.message : 'Could not reach Freero.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, userId, attempt]);

  const allow = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { token, expiresAt } = await api.publicEmbedToken(id, readonly);
      tell({ freeroEmbedConnect: 'token', boardId: id, token, expiresAt });
      window.close();
    } catch (e) {
      if (e instanceof ApiError && e.code === EMBED_NO_ACCESS) setNoAccess(true);
      else setError(e instanceof ApiError ? e.message : 'Could not reach Freero.');
    } finally {
      setBusy(false);
    }
  }, [id, readonly]);

  if (!opened)
    return (
      <Card title="Open this from the embedded board">
        <p>This window signs you in to a Freero board shown on another site. Use “Sign in” on the board there.</p>
      </Card>
    );
  if (loading) return <Card title="Signing in"><Spinner size={22} label="Checking your session" /></Card>;
  if (!user)
    return (
      <Card title="Sign in to Freero">
        <p>Sign in to see this board on {site}. A new tab opens; come back here when you’re signed in.</p>
        <div className="fr-boarderror__actions">
          <Button variant="primary" onClick={() => window.open(loginPath('/embed/signed-in'), '_blank')}>
            Sign in
          </Button>
          <Button onClick={() => window.open(loginPath('/embed/signed-in', 'signup'), '_blank')}>Create an account</Button>
        </div>
      </Card>
    );
  if (noAccess) return <RequestAccess boardId={id} onGranted={granted} />;
  if (error)
    return (
      <Card title="Couldn’t sign in here">
        <p>{error}</p>
      </Card>
    );
  if (!board) return <Card title="Signing in"><Spinner size={22} label="Opening the board" /></Card>;
  const role: Role = readonly ? 'viewer' : board.role;
  return (
    <Card title={`Show “${board.title || 'Untitled board'}” on ${site}?`}>
      <p>
        You’ll see it there as {user.name} and can {ROLE_TEXT[role]}.{role !== 'viewer' ? ' Changes start only after you click Edit on the board there.' : ''} Signing out of
        Freero ends it.
      </p>
      <div className="fr-boarderror__actions">
        <Button variant="primary" loading={busy} onClick={() => void allow()}>
          Continue
        </Button>
        <Button onClick={() => window.close()}>Cancel</Button>
      </div>
    </Card>
  );
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
