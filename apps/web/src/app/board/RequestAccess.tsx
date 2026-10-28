// The page for a board the signed-in user can't open: ask for access (with a role and a note), then
// wait — the page lets them in as soon as someone approves. The answer arrives as a notification,
// so the notifications socket (live on every instance) wakes the page up; a slow poll covers a
// socket that can't connect.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Lock } from 'lucide-react';
import type { AccessRequestState, Role } from '@freero/shared';
import { Button, Logo, Select, Spinner, TextArea, type SelectOption } from '@ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { loginPath } from '../lib/nav';
import { notificationsStore, retainLiveConnection } from '../notifications/store';

const ROLE_OPTIONS: SelectOption<Exclude<Role, 'owner'>>[] = [
  { value: 'editor', label: 'Can edit' },
  { value: 'commenter', label: 'Can comment' },
  { value: 'viewer', label: 'Can view' },
];
const POLL_MS = 20_000;

export function RequestAccess({ boardId, onGranted }: { boardId: string; onGranted: () => void }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [state, setState] = useState<AccessRequestState | null>(null);
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('editor');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const s = await api.accessRequestState(boardId);
      setState(s);
      if (s.status === 'granted') onGranted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach Freero. Check your connection.');
    }
  }, [boardId, onGranted]);

  useEffect(() => void check(), [check]);

  // While a request waits: re-check whenever a notification arrives (the answer is one) and now and then.
  const waiting = state?.status === 'pending';
  const userId = user?.id;
  useEffect(() => {
    if (!waiting || !userId) return;
    const release = retainLiveConnection(userId);
    let last = notificationsStore.getState().unread;
    const unsubscribe = notificationsStore.subscribe((s) => {
      if (s.unread !== last) void check();
      last = s.unread;
    });
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      release();
      unsubscribe();
      clearInterval(timer);
    };
  }, [waiting, userId, check]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await api.requestAccess(boardId, role, message.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the request');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    try {
      setState(await api.withdrawAccessRequest(boardId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not withdraw the request');
    } finally {
      setBusy(false);
    }
  };

  const switchAccount = async () => {
    await logout();
    navigate(loginPath(`/board/${boardId}`), { replace: true });
  };

  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card fr-reqaccess">
        <Logo size={36} />
        {!state ? (
          <div className="fr-reqaccess__loading">
            <Spinner size={22} />
          </div>
        ) : state.status === 'pending' ? (
          <>
            <span className="fr-reqaccess__badge" aria-hidden>
              <Clock size={18} />
            </span>
            <h1>Request sent</h1>
            <p>The board’s owner has been asked. Keep this page open — you’ll be taken to the board as soon as they let you in.</p>
            <div className="fr-reqaccess__waiting" role="status">
              <Spinner size={16} /> Waiting for an answer…
            </div>
            <div className="fr-boarderror__actions">
              <Button onClick={() => navigate('/app')}>Back to dashboard</Button>
              <Button variant="ghost" loading={busy} onClick={withdraw}>
                Withdraw request
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="fr-reqaccess__badge" aria-hidden>
              <Lock size={18} />
            </span>
            <h1>{state.status === 'denied' ? 'Your request was declined' : 'You need access to this board'}</h1>
            <p>
              {state.canRequest
                ? 'Ask for access and the board’s owner will get a notification. You can say why you need it.'
                : (state.reason ?? 'Ask the board owner to invite you, or switch to the account they shared it with.')}
            </p>
            {user ? (
              <p className="fr-boarderror__account">
                Signed in as <strong>{user.email}</strong>
              </p>
            ) : null}
            {state.canRequest ? (
              <form
                className="fr-reqaccess__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label className="fr-reqaccess__role">
                  <span>Access you need</span>
                  <Select<Exclude<Role, 'owner'>> aria-label="Access you need" options={ROLE_OPTIONS} value={role} onChange={setRole} width={170} />
                </label>
                <TextArea
                  aria-label="Message to the owner"
                  placeholder="Add a note (optional)"
                  value={message}
                  maxLength={500}
                  rows={3}
                  onChange={(e) => setMessage(e.target.value)}
                />
                {error ? (
                  <p className="fr-reqaccess__error" role="alert">
                    {error}
                  </p>
                ) : null}
                <Button type="submit" variant="primary" size="lg" loading={busy}>
                  Request access
                </Button>
              </form>
            ) : error ? (
              <p className="fr-reqaccess__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="fr-boarderror__actions">
              <Button onClick={() => navigate('/app')}>Back to dashboard</Button>
              <Button variant="ghost" onClick={switchAccount}>
                Switch account
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
