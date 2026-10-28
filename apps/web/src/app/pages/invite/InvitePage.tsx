import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Users } from 'lucide-react';
import { Button, Spinner } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AuthNotice, AuthShell } from '../auth/AuthShell';

const ROLE_TEXT = { editor: 'edit', commenter: 'comment on', viewer: 'view' } as const;
const WS_ROLE_TEXT = { admin: 'as an admin', member: 'as a member', guest: 'as a guest' } as const;

/** What the page shows and does, for a board invite or a workspace invite. */
interface Preview {
  inviterName: string;
  email: string;
  name: string;
  sub: string;
}

const KINDS = {
  board: {
    path: '/invite/',
    noun: 'board',
    icon: LayoutDashboard,
    preview: async (token: string): Promise<Preview> => {
      const { invite } = await api.previewInvite(token);
      return { inviterName: invite.inviterName, email: invite.email, name: invite.boardTitle, sub: `You can ${ROLE_TEXT[invite.role]} this board.` };
    },
    accept: async (token: string) => `/board/${(await api.acceptInvite(token)).boardId}`,
  },
  workspace: {
    path: '/workspace-invite/',
    noun: 'workspace',
    icon: Users,
    preview: async (token: string): Promise<Preview> => {
      const { invite } = await api.previewWorkspaceInvite(token);
      return {
        inviterName: invite.inviterName,
        email: invite.email,
        name: invite.workspaceName,
        sub: `Join their team workspace ${WS_ROLE_TEXT[invite.role]}.`,
      };
    },
    accept: async (token: string) => `/app?ws=${encodeURIComponent((await api.acceptWorkspaceInvite(token)).workspaceId)}`,
  },
} as const;

/**
 * /invite/:token (a board) and /workspace-invite/:token (a team workspace) — the link from an
 * invite email. Signed out: sign up (email prefilled) or log in, then come back here with ?join=1,
 * which accepts at once and opens it. Signed in: join.
 */
export function InvitePage({ kind = 'board' }: { kind?: keyof typeof KINDS }) {
  const k = KINDS[kind];
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const autoJoin = params.get('join') === '1';
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    let live = true;
    k.preview(token).then(
      (invite) => live && setInvite(invite),
      (err) => live && setError(err instanceof ApiError ? err.message : 'Could not reach Freero. Try again.'),
    );
    return () => {
      live = false;
    };
  }, [token, k]);

  const join = async () => {
    setJoining(true);
    try {
      navigate(await k.accept(token), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not join the ${k.noun}. Try again.`);
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

  const back = `${k.path}${encodeURIComponent(token)}?join=1`;

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
      sub={invite.sub}
    >
      <div className="fr-authcard__invite">
        <span className="fr-authcard__invite-icon" aria-hidden>
          <k.icon size={20} />
        </span>
        <span className="fr-authcard__invite-board">
          <strong>{invite.name}</strong>
          Sent to {invite.email}
        </span>
      </div>
      {user ? (
        <>
          {user.email !== invite.email ? (
            <AuthNotice kind="error">
              You're signed in as {user.email}. Joining adds this account to the {k.noun}.
            </AuthNotice>
          ) : null}
          <div className="fr-authcard__actions">
            <Button variant="primary" size="lg" block loading={joining} onClick={join}>
              Join {k.noun}
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
