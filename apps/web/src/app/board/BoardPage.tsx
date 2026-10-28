// Route /board/:id — loads the board, builds the Host and mounts the engine.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { guestDisplayName, type BoardAiStatus, type BoardSummary, type BoardTrackersResponse, type GuestInfo } from '@freero/shared';
import { BoardEngine, type Host } from '@engine';
import { Button, Logo, useToast } from '@ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { loginPath } from '../lib/nav';
import { ShareDialog } from '../components/ShareDialog';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { NotificationBell } from '../notifications/NotificationBell';
import { features } from './features';
import { createGuestHost, createLocalHost, createServerHost, toastNotify } from './host';
import { RequestAccess } from './RequestAccess';
import './BoardPage.css';

type Team = { id: string; name: string } | null;
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; board: BoardSummary; team?: Team; ai?: BoardAiStatus | null; trackers?: BoardTrackersResponse['connections'] }
  | { status: 'error'; code: number; message: string };

/** `guest`: a visitor without an account who joined this board by its link (GuestGate). */
export default function BoardPage({ guest, onGuestEnded }: { guest?: GuestInfo; onGuestEnded?: () => void } = {}) {
  const { id = '' } = useParams();
  const isLocal = import.meta.env.DEV && id === 'local';
  if (isLocal) return <LocalBoard />;
  if (guest) return <GuestBoard id={id} guest={guest} onEnded={onGuestEnded ?? (() => window.location.reload())} />;
  return <ServerBoard id={id} />;
}

/** A guest on the board they joined: no dashboard, sharing, templates or history — only this board. */
function GuestBoard({ id, guest, onEnded }: { id: string; guest: GuestInfo; onEnded: () => void }) {
  const navigate = useNavigate();
  const notify = useToast();
  const location = useLocation();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const next = location.pathname + location.search;

  useEffect(() => {
    let cancelled = false;
    api.guestBoard(id).then(
      ({ board }) => !cancelled && setState({ status: 'ready', board }),
      (err) =>
        !cancelled &&
        setState({ status: 'error', code: err instanceof ApiError ? err.status : 0, message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  const board = state.status === 'ready' ? state.board : null;
  const go = useCallback((path: string) => navigate(path), [navigate]);
  const toast = useMemo(() => toastNotify(notify), [notify]);
  const host = useMemo<Host | null>(
    () =>
      board
        ? createGuestHost(board, {
            user: { id: guest.id, name: guestDisplayName(guest.name), color: guest.color, avatarUrl: null },
            navigate: go,
            notify: toast,
            signUpPath: loginPath(next, 'signup'),
          })
        : null,
    [board, guest, go, toast, next],
  );
  const signUp = useMemo(
    () => (
      <Button variant="secondary" size="sm" onClick={() => navigate(loginPath(next, 'signup'))}>
        Sign up free
      </Button>
    ),
    [navigate, next],
  );

  if (state.status === 'error') {
    const ended = state.code === 401 || state.code === 403;
    const removed = state.code === 451; // taken down by Freero's moderators (KAI-142)
    return (
      <div className="fr-boarderror">
        <div className="fr-boarderror__card">
          <Logo size={36} />
          <h1>{removed ? 'This board was removed for review' : ended ? 'Your guest visit has ended' : "We couldn't open this board"}</h1>
          <p>{ended ? 'Guest visits last a few hours, and end when the board stops being shared by link.' : state.message}</p>
          <div className="fr-boarderror__actions">
            <Button variant="primary" size="lg" onClick={onEnded}>
              Join again
            </Button>
            <Button size="lg" onClick={() => navigate(loginPath(next))}>
              Sign in
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (!host) return <FullPageSpinner label="Opening board" />;
  return <BoardEngine host={host} features={features} topbarAccessory={signUp} location={location} />;
}

function ServerBoard({ id }: { id: string }) {
  const navigate = useNavigate();
  const notify = useToast();
  const { user } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const location = useLocation();
  // `?share=requests` (an access-request notification): open the share dialog on its requests.
  const [shareOpen, setShareOpen] = useState(() => new URLSearchParams(location.search).has('share'));
  const bell = useMemo(() => <NotificationBell />, []);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    if (new URLSearchParams(location.search).has('share')) setShareOpen(true);
  }, [location.search]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    // The board, and the team workspace it belongs to when the user is a full member there.
    // AI: whether this user may use it on this board (404, or any failure: no AI entry points).
    // Trackers: the connections this user may use here (any failure: no tracker entry points).
    Promise.all([
      api.getBoard(id),
      api.listWorkspaces().catch(() => ({ workspaces: [] })),
      api.boardAi(id).catch(() => ({ ai: null })),
      api.boardTrackers(id).catch(() => ({ connections: [] })),
    ])
      .then(([{ board }, { workspaces }, { ai }, { connections }]) => {
        if (cancelled) return;
        const w = workspaces.find((x) => x.id === board.workspaceId && x.kind === 'team' && x.role !== 'guest');
        setState({ status: 'ready', board, team: w ? { id: w.id, name: w.name } : null, ai, trackers: connections });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          navigate(loginPath(`/board/${id}`), { replace: true });
          return;
        }
        setState({
          status: 'error',
          code: err instanceof ApiError ? err.status : 0,
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id, navigate, attempt]);

  const board = state.status === 'ready' ? state.board : null;
  const team = state.status === 'ready' ? (state.team ?? null) : null;
  const ai = state.status === 'ready' ? (state.ai ?? null) : null;
  const trackers = state.status === 'ready' ? state.trackers : undefined;
  const setTitle = useCallback(
    (title: string) => setState((s) => (s.status === 'ready' ? { ...s, board: { ...s.board, title } } : s)),
    [],
  );
  const openShare = useCallback(() => setShareOpen(true), []);
  const go = useCallback((path: string) => navigate(path), [navigate]);
  const toast = useMemo(() => toastNotify(notify), [notify]);

  const host = useMemo<Host | null>(() => {
    if (!board || !user) return null;
    return createServerHost(board, {
      user: { id: user.id, name: user.name, color: user.color, avatarUrl: user.avatarUrl },
      navigate: go,
      notify: toast,
      openShareDialog: openShare,
      onTitleChange: setTitle,
      team,
      ai,
      trackers,
    });
    // Rebuild only for identity-relevant changes; title/role updates flow through a new host object.
  }, [board, team, ai, trackers, user, go, toast, openShare, setTitle]);

  if (state.status === 'error' && state.code === 403) return <RequestAccess boardId={id} onGranted={retry} />;
  if (state.status === 'error') return <BoardError boardId={id} code={state.code} message={state.message} />;
  if (!host || !board) return <FullPageSpinner label="Opening board" />;
  return (
    <>
      <BoardEngine host={host} features={features} topbarAccessory={bell} location={location} />
      <ShareDialog
        boardId={board.id}
        open={shareOpen}
        onClose={() => {
          setShareOpen(false);
          if (new URLSearchParams(location.search).has('share')) navigate(location.pathname, { replace: true });
        }}
        board={board}
        onBoardChange={(b) =>
          setState((s) => ({ status: 'ready', board: b, team: s.status === 'ready' ? s.team : null, ai: s.status === 'ready' ? s.ai : null, trackers: s.status === 'ready' ? s.trackers : undefined }))
        }
        onLeft={() => navigate('/app')}
      />
    </>
  );
}

function LocalBoard() {
  const navigate = useNavigate();
  const notify = useToast();
  const [title, setTitle] = useState(() => localStorage.getItem('freero:local-title') ?? 'Local sandbox');
  const go = useCallback((path: string) => navigate(path), [navigate]);
  const toast = useMemo(() => toastNotify(notify), [notify]);
  const host = useMemo(
    () =>
      createLocalHost(title, {
        navigate: go,
        notify: toast,
        onTitleChange: (t) => {
          localStorage.setItem('freero:local-title', t);
          setTitle(t);
        },
      }),
    [title, go, toast],
  );
  return <BoardEngine host={host} features={features} />;
}

function BoardError({ boardId, code, message }: { boardId: string; code: number; message: string }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const switchAccount = async () => {
    await logout();
    navigate(loginPath(`/board/${boardId}`), { replace: true });
  };
  const copy =
    code === 451
      ? {
          title: 'This board was removed for review',
          body: 'Freero’s moderators took it down after a report. If it is your board, we emailed you the reason and how to appeal.',
        }
      : code === 403
      ? { title: "You don't have access to this board", body: 'Ask the board owner to invite you, or switch to the account they shared it with.' }
      : code === 404
        ? { title: 'This board does not exist', body: 'It may have been deleted, or the link is mistyped.' }
        : { title: "We couldn't open this board", body: message || 'Check your connection and try again.' };
  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card">
        <Logo size={36} />
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        {code === 403 && user ? (
          <p className="fr-boarderror__account">
            Signed in as <strong>{user.email}</strong>
          </p>
        ) : null}
        <div className="fr-boarderror__actions">
          <Button variant="primary" size="lg" onClick={() => navigate('/app')}>
            Back to dashboard
          </Button>
          {code === 403 && (
            <Button size="lg" onClick={switchAccount}>
              Switch account
            </Button>
          )}
          {code !== 403 && code !== 404 && code !== 451 && (
            <Button size="lg" onClick={() => window.location.reload()}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
