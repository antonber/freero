// /board/:id for someone who isn't signed in: when the board's link lets visitors without an
// account in, they can join under a name (as "Guest · <name>") or sign in; otherwise it's the
// sign-in page. A browser that already joined this board as a guest goes straight in.
import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Eye, MessageSquare } from 'lucide-react';
import { guestDisplayName, MAX_GUEST_NAME, type GuestBoardInfo, type GuestInfo } from '@freero/shared';
import { Button, Input, Logo } from '@ui';
import { api, ApiError } from '../api/client';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { loginPath } from '../lib/nav';
import './BoardPage.css';

const BoardPage = lazy(() => import('./BoardPage'));

type Gate =
  | { status: 'loading' }
  | { status: 'guest'; guest: GuestInfo }
  | { status: 'offer'; info: GuestBoardInfo }
  | { status: 'sign-in' };

export function GuestGate({ boardId }: { boardId: string }) {
  const location = useLocation();
  const [gate, setGate] = useState<Gate>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setGate({ status: 'loading' });
    (async () => {
      const { guest } = await api.guestMe();
      if (guest && guest.boardId === boardId) return { status: 'guest', guest } as const;
      const info = await api.guestBoardInfo(boardId);
      return info.allowed ? ({ status: 'offer', info } as const) : ({ status: 'sign-in' } as const);
    })().then(
      (g) => !cancelled && setGate(g),
      () => !cancelled && setGate({ status: 'sign-in' }),
    );
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  if (gate.status === 'loading') return <FullPageSpinner label="Opening board" />;
  if (gate.status === 'sign-in') return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  if (gate.status === 'guest')
    return (
      <Suspense fallback={<FullPageSpinner label="Opening board" />}>
        <BoardPage guest={gate.guest} onGuestEnded={() => setGate({ status: 'loading' })} />
      </Suspense>
    );
  return <JoinAsGuest boardId={boardId} info={gate.info} onJoined={(guest) => setGate({ status: 'guest', guest })} />;
}

function JoinAsGuest({ boardId, info, onJoined }: { boardId: string; info: GuestBoardInfo; onJoined: (g: GuestInfo) => void }) {
  const location = useLocation();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = location.pathname + location.search;

  const join = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Enter a name so others know who you are');
    setBusy(true);
    setError(null);
    try {
      onJoined((await api.joinAsGuest(boardId, name.trim())).guest);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join the board');
      setBusy(false);
    }
  };

  const Icon = info.role === 'commenter' ? MessageSquare : Eye;
  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card fr-reqaccess">
        <Logo size={36} />
        <h1>{info.title || 'Untitled board'}</h1>
        <p className="fr-guestjoin__role">
          <Icon size={15} aria-hidden /> You can {info.role === 'commenter' ? 'view and comment' : 'view'} without an account
        </p>
        <form className="fr-reqaccess__form" onSubmit={join} noValidate>
          <Input
            aria-label="Your name"
            placeholder="Your name"
            value={name}
            maxLength={MAX_GUEST_NAME}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            error={error ?? undefined}
          />
          <span className="fr-guestjoin__hint">Others will see you as “{guestDisplayName(name.trim() || 'your name')}”. Your visit lasts a few hours.</span>
          <Button type="submit" variant="primary" size="lg" loading={busy}>
            Join as guest
          </Button>
        </form>
        <p className="fr-boarderror__account">
          Have an account? <Link to={loginPath(next)}>Sign in</Link> · <Link to={loginPath(next, 'signup')}>Sign up free</Link>
        </p>
      </div>
    </div>
  );
}
