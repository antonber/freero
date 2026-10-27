// Route /board/:id — loads the board, builds the Host and mounts the engine.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { BoardSummary } from '@freero/shared';
import { BoardEngine, type Host } from '@engine';
import { Button, Logo, useToast } from '@ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ShareDialog } from '../components/ShareDialog';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { features } from './features';
import { createLocalHost, createServerHost, toastNotify } from './host';
import './BoardPage.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; board: BoardSummary }
  | { status: 'error'; code: number; message: string };

export default function BoardPage() {
  const { id = '' } = useParams();
  const isLocal = import.meta.env.DEV && id === 'local';
  return isLocal ? <LocalBoard /> : <ServerBoard id={id} />;
}

function ServerBoard({ id }: { id: string }) {
  const navigate = useNavigate();
  const notify = useToast();
  const { user } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    api
      .getBoard(id)
      .then(({ board }) => !cancelled && setState({ status: 'ready', board }))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          navigate(`/login?next=${encodeURIComponent(`/board/${id}`)}`, { replace: true });
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
  }, [id, navigate]);

  const board = state.status === 'ready' ? state.board : null;
  const setTitle = useCallback(
    (title: string) => setState((s) => (s.status === 'ready' ? { status: 'ready', board: { ...s.board, title } } : s)),
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
    });
    // Rebuild only for identity-relevant changes; title/role updates flow through a new host object.
  }, [board, user, go, toast, openShare, setTitle]);

  if (state.status === 'error') return <BoardError code={state.code} message={state.message} />;
  if (!host || !board) return <FullPageSpinner label="Opening board" />;
  return (
    <>
      <BoardEngine host={host} features={features} />
      <ShareDialog
        boardId={board.id}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        board={board}
        onBoardChange={(b) => setState({ status: 'ready', board: b })}
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

function BoardError({ code, message }: { code: number; message: string }) {
  const navigate = useNavigate();
  const copy =
    code === 403
      ? { title: "You don't have access to this board", body: 'Ask the board owner to invite you, or check that you are signed in with the right account.' }
      : code === 404
        ? { title: 'This board does not exist', body: 'It may have been deleted, or the link is mistyped.' }
        : { title: "We couldn't open this board", body: message || 'Check your connection and try again.' };
  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card">
        <Logo size={36} />
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        <div className="fr-boarderror__actions">
          <Button variant="primary" size="lg" onClick={() => navigate('/app')}>
            Back to dashboard
          </Button>
          {code !== 403 && code !== 404 && (
            <Button size="lg" onClick={() => window.location.reload()}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
