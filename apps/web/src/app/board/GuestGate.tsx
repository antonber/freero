// /board/:id for someone who isn't signed in: when the board's link lets visitors without an
// account in, they can join under a name (as "Guest · <name>") or sign in; otherwise it's the
// sign-in page. A browser that already joined this board as a guest goes straight in.
import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Eye, MessageSquare, Pencil } from 'lucide-react';
import { guestDisplayName, LINK_PASSWORD_MAX, MAX_GUEST_NAME, type GuestBoardInfo, type GuestInfo } from '@freero/shared';
import { Button, Input, Logo } from '@ui';
import { api, ApiError } from '../api/client';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { loginPath } from '../lib/nav';
import { t } from '../messages';
import './BoardPage.css';

const BoardPage = lazy(() => import('./BoardPage'));

type Gate =
  | { status: 'loading' }
  | { status: 'guest'; guest: GuestInfo }
  | { status: 'offer'; info: GuestBoardInfo }
  | { status: 'removed' }
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
      if (info.removed) return { status: 'removed' } as const;
      return info.allowed ? ({ status: 'offer', info } as const) : ({ status: 'sign-in' } as const);
    })().then(
      (g) => !cancelled && setGate(g),
      () => !cancelled && setGate({ status: 'sign-in' }),
    );
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  if (gate.status === 'loading') return <FullPageSpinner label={t('openingBoard')} />;
  if (gate.status === 'sign-in') return <Navigate to={loginPath(location.pathname + location.search)} replace />;
  if (gate.status === 'removed') {
    const next = location.pathname + location.search;
    return (
      <div className="fr-boarderror">
        <div className="fr-boarderror__card fr-reqaccess">
          <Logo size={36} />
          <h1>{t('youWereRemovedFromThisBoard')}</h1>
          <p>{t('theBoardSOwnerRemovedYou')}</p>
          <p className="fr-boarderror__account">
            {t('haveAnAccount')} <Link to={loginPath(next)}>{t('signIn')}</Link>
          </p>
        </div>
      </div>
    );
  }
  if (gate.status === 'guest')
    return (
      <Suspense fallback={<FullPageSpinner label={t('openingBoard')} />}>
        <BoardPage guest={gate.guest} onGuestEnded={() => setGate({ status: 'loading' })} />
      </Suspense>
    );
  return <JoinAsGuest boardId={boardId} info={gate.info} onJoined={(guest) => setGate({ status: 'guest', guest })} />;
}

function JoinAsGuest({ boardId, info, onJoined }: { boardId: string; info: GuestBoardInfo; onJoined: (g: GuestInfo) => void }) {
  const location = useLocation();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = location.pathname + location.search;

  const join = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(t('enterANameSoOthers'));
    if (info.passwordRequired && !password) return setError(t('enterTheLinkSPassword'));
    setBusy(true);
    setError(null);
    try {
      onJoined((await api.joinAsGuest(boardId, name.trim(), info.passwordRequired ? password : undefined)).guest);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('couldNotJoinTheBoard'));
      setBusy(false);
    }
  };

  const Icon = info.canEdit ? Pencil : info.role === 'commenter' ? MessageSquare : Eye;
  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card fr-reqaccess">
        <Logo size={36} />
        <h1>{info.title || t('untitledBoard')}</h1>
        <p className="fr-guestjoin__role">
          <Icon size={15} aria-hidden />{' '}{t('youCan')}{' '}{info.canEdit ? t('guestsViewAndEdit') : info.role === 'commenter' ? t('viewAndComment') : 'view'}{' '}{t('withoutAnAccount')}</p>
        <form className="fr-reqaccess__form" onSubmit={join} noValidate>
          <Input
            aria-label={t('yourName')}
            placeholder={t('yourName')}
            value={name}
            maxLength={MAX_GUEST_NAME}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            error={error ?? undefined}
          />
          {info.passwordRequired ? (
            <Input
              type="password"
              aria-label={t('linkPassword')}
              placeholder={t('passwordAskTheBoardS')}
              autoComplete="off"
              maxLength={LINK_PASSWORD_MAX}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
            />
          ) : null}
          <span className="fr-guestjoin__hint">{t('othersWillSeeYouAs', { guestDisplayName: guestDisplayName(name.trim() || 'your name') })}</span>
          <Button type="submit" variant="primary" size="lg" loading={busy}>{t('joinAsGuest')}</Button>
        </form>
        <p className="fr-boarderror__account">{t('haveAnAccount')}{' '}<Link to={loginPath(next)}>{t('signIn')}</Link> · <Link to={loginPath(next, 'signup')}>{t('signUpFree')}</Link>
        </p>
      </div>
    </div>
  );
}
