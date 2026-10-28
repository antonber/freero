import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import type { InvitePreview } from '@freero/shared';
import { Button, Spinner } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AuthNotice, AuthShell } from '../auth/AuthShell';

const ROLE_TEXT = { editor: 'edit', commenter: 'comment on', viewer: 'view' } as const;

/**
 * /invite/:token — the link from an invite email. Signed out: sign up (email prefilled) or log in,
 * then come back here with ?join=1, which accepts at once and opens the board. Signed in: join.
 */
export function InvitePage() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const autoJoin = params.get('join') === '1';
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    let live = true;
    api.previewInvite(token).then(
      ({ invite }) => live && setInvite(invite),
      (err) => live && setError(err instanceof ApiError ? err.message : 'Could not reach Freero. Try again.'),
    );
    return () => {
      live = false;
    };
  }, [token]);

  const join = async () => {
    setJoining(true);
    try {
      const { boardId } = await api.acceptInvite(token);
      navigate(`/board/${boardId}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join the board. Try again.');
      setJoining(false);
    }
  };

  // Back from sign-up / log-in: land on the board without another click.
  useEffect(() => {
    if (autoJoin && user && !user.deletionScheduledFor && invite && !tried.current) {
      tried.current = true;
      void join();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoin, user, invite]);

  const back = `/invite/${encodeURIComponent(token)}?join=1`;

  if (error)
    return (
      <AuthShell docTitle="Invite" title="This invite can’t be used">
        <AuthNotice kind="error">{error}</AuthNotice>
        <p className="fr-authcard__switch">
          <Link to={user ? '/app' : '/login'}>{user ? 'Go to your boards' : 'Log in'}</Link>
        </p>
      </AuthShell>
    );

  if (!invite || loading)
    return (
      <AuthShell docTitle="Invite" title="Opening your invite…">
        <Spinner size={22} label="Loading the invite" />
      </AuthShell>
    );

  return (
    <AuthShell
      docTitle="You're invited"
      title={`${invite.inviterName} invited you`}
      sub={`You can ${ROLE_TEXT[invite.role]} this board.`}
    >
      <div className="fr-authcard__invite">
        <span className="fr-authcard__invite-icon" aria-hidden>
          <LayoutDashboard size={20} />
        </span>
        <span className="fr-authcard__invite-board">
          <strong>{invite.boardTitle}</strong>
          Sent to {invite.email}
        </span>
      </div>
      {user ? (
        <>
          {user.email !== invite.email ? (
            <AuthNotice kind="error">
              You're signed in as {user.email}. Joining adds this account to the board.
            </AuthNotice>
          ) : null}
          <div className="fr-authcard__actions">
            <Button variant="primary" size="lg" block loading={joining} onClick={join}>
              Join board
            </Button>
          </div>
        </>
      ) : (
        <div className="fr-authcard__actions">
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => navigate(`/signup?next=${encodeURIComponent(back)}&email=${encodeURIComponent(invite.email)}`)}
          >
            Create a free account
          </Button>
          <Button size="lg" block onClick={() => navigate(`/login?next=${encodeURIComponent(back)}&email=${encodeURIComponent(invite.email)}`)}>
            I already have an account
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
