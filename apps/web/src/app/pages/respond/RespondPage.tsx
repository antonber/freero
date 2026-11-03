// /respond/:boardId/:activityId (#40): answering a live activity on a phone without the board — no
// Yjs, no canvas, only the activity REST of modules/engage (GET the activity, PUT the answer…),
// which checks the board, the activity and guests. Someone who isn't signed in joins as a guest
// right here (name, and the link's password when it has one) when the board's link lets them.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { guestDisplayName, LINK_PASSWORD_MAX, LINK_PASSWORD_REQUIRED, MAX_GUEST_NAME, type ActivityState, type GuestBoardInfo } from '@freero/shared';
import { ActivityForm, Button, Input, Logo, Spinner, type ActivityActions } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { LinkPassword } from '../../board/LinkPassword';
import { loginPath } from '../../lib/nav';
import './RespondPage.css';

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; state: ActivityState }
  | { kind: 'join'; info: GuestBoardInfo }
  | { kind: 'password' }
  | { kind: 'sign-in' }
  | { kind: 'gone'; message: string };

/** Results and "answers closed" change while you look: re-read now and then (no socket here); a quiz moves faster. */
const REFRESH_MS = 8000;
const QUIZ_REFRESH_MS = 2000;

export function RespondPage() {
  const { boardId = '', activityId = '' } = useParams();
  const { user, loading } = useAuth();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const here = `/respond/${encodeURIComponent(boardId)}/${encodeURIComponent(activityId)}`;

  const load = useCallback(async (): Promise<View> => {
    try {
      return { kind: 'ready', state: await api.activity(boardId, activityId) };
    } catch (e) {
      if (!(e instanceof ApiError)) return { kind: 'gone', message: 'Couldn’t reach Freero. Check your connection and try again.' };
      if (e.code === LINK_PASSWORD_REQUIRED) return { kind: 'password' };
      if (e.status === 401) {
        const info = await api.guestBoardInfo(boardId).catch(() => null);
        return info?.allowed ? { kind: 'join', info } : { kind: 'sign-in' };
      }
      if (e.status === 403) return user ? { kind: 'gone', message: 'You don’t have access to this board. Ask its owner to share it with you.' } : { kind: 'sign-in' };
      return { kind: 'gone', message: e.message || 'This activity is no longer on the board.' };
    }
  }, [boardId, activityId, user]);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    void load().then((v) => !cancelled && setView(v));
    return () => {
      cancelled = true;
    };
  }, [load, loading]);

  // While answering: pick up new results, questions, and "answers closed" from time to time.
  const ready = view.kind === 'ready';
  const quiz = view.kind === 'ready' && view.state.activity?.kind === 'quiz';
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      api.activity(boardId, activityId).then(
        (state) => setView((v) => (v.kind === 'ready' ? { kind: 'ready', state } : v)),
        () => undefined,
      );
    }, quiz ? QUIZ_REFRESH_MS : REFRESH_MS);
    return () => clearInterval(t);
  }, [ready, quiz, boardId, activityId]);

  const retry = () => void load().then(setView);
  const actions: ActivityActions = {
    answer: (answer) => api.answerActivity(boardId, activityId, answer),
    withdraw: () => api.withdrawAnswer(boardId, activityId),
    ask: (text) => api.askQuestion(boardId, activityId, text),
    upvote: (qid, on) => api.upvoteQuestion(boardId, activityId, qid, on),
    ...(view.kind === 'ready' && view.state.canRun ? { moderate: (qid: string, patch: { answered?: boolean; hidden?: boolean }) => api.moderateQuestion(boardId, activityId, qid, patch) } : {}),
  };

  if (view.kind === 'password')
    return <LinkPassword unlock={(pw) => (user ? api.unlockBoardLink(boardId, pw) : api.guestUnlock(boardId, pw))} onUnlocked={retry} />;

  return (
    <main className="fr-respond">
      <header className="fr-respond__head">
        <Logo size={28} />
      </header>
      <section className="fr-respond__card">
        {view.kind === 'loading' ? (
          <div className="fr-respond__center">
            <Spinner />
          </div>
        ) : null}
        {view.kind === 'ready' && view.state.activity ? (
          <ActivityForm activity={view.state.activity} state={view.state} onState={(state) => setView({ kind: 'ready', state })} actions={actions} />
        ) : null}
        {view.kind === 'ready' && !view.state.activity ? <p>Update Freero’s server to answer from this page, or open the board.</p> : null}
        {view.kind === 'join' ? <JoinHere boardId={boardId} info={view.info} next={here} onJoined={retry} /> : null}
        {view.kind === 'sign-in' ? (
          <div className="fr-respond__center">
            <p>Sign in to answer this activity.</p>
            <Link className="fr-respond__btn" to={loginPath(here)}>
              Sign in
            </Link>
          </div>
        ) : null}
        {view.kind === 'gone' ? (
          <div className="fr-respond__center">
            <p>{view.message}</p>
            <Button variant="ghost" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : null}
      </section>
      <footer className="fr-respond__foot">
        <Link to={`/board/${encodeURIComponent(boardId)}`}>Open the board</Link>
      </footer>
    </main>
  );
}

/** A visitor without an account joins the board as a guest, right here (#40). */
function JoinHere({ boardId, info, next, onJoined }: { boardId: string; info: GuestBoardInfo; next: string; onJoined: () => void }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const join = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Enter a name so the host knows who answered');
    if (info.passwordRequired && !password) return setError('Enter the link’s password');
    setBusy(true);
    setError(null);
    try {
      await api.joinAsGuest(boardId, name.trim(), info.passwordRequired ? password : undefined);
      onJoined();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join');
      setBusy(false);
    }
  };
  return (
    <form className="fr-respond__join" onSubmit={join} noValidate>
      <h1>{info.title || 'Untitled board'}</h1>
      <p>Join to answer — no account needed.</p>
      <Input aria-label="Your name" placeholder="Your name" value={name} maxLength={MAX_GUEST_NAME} autoFocus onChange={(e) => setName(e.target.value)} error={error ?? undefined} />
      {info.passwordRequired ? (
        <Input
          type="password"
          aria-label="Link password"
          placeholder="Password (ask the host)"
          autoComplete="off"
          maxLength={LINK_PASSWORD_MAX}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      ) : null}
      <span className="fr-respond__hint">You’ll be “{guestDisplayName(name.trim() || 'your name')}” for a few hours.</span>
      <Button type="submit" variant="primary" size="lg" loading={busy}>
        Join and answer
      </Button>
      <p className="fr-respond__hint">
        Have an account? <Link to={loginPath(next)}>Sign in</Link>
      </p>
    </form>
  );
}
