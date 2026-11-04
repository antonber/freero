// Route /embed/choose — "Choose from your boards" for a Freero frame on another platform (the
// Google Meet side panel, the Zoom App in Zoom's web client), which has no session of its own. It is
// Freero's own page in its own window (first party: the person's session is here): they sign in if
// needed, pick a board, and it posts the board — with a token for its embeds, so the frame opens
// signed in — to `window.opener` with targetOrigin = Freero's own origin (only a Freero frame can
// receive it), then closes. The server keeps window.opener for this path and never lets it be framed.
import { useCallback, useEffect, useState } from 'react';
import type { BoardSummary, EmbedChooseMessage } from '@freero/shared';
import { Button, Logo, Spinner } from '@ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { signInFromWindow } from '../embed/EmbedConnectPage';
import { BoardPicker } from './BoardPicker';
import { t } from './messages';
import '../board/BoardPage.css';
import './hosts.css';

export default function EmbedChoosePage() {
  const { user, loading, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opened = typeof window.opener === 'object' && window.opener !== null;

  // Signed in in another tab: pick the session up when this window gets focus back.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const choose = useCallback(async (b: BoardSummary) => {
    setBusy(true);
    setError(null);
    try {
      const { token, expiresAt } = await api.publicEmbedToken(b.id, false);
      const msg: EmbedChooseMessage = { freeroEmbedChoose: 'board', boardId: b.id, title: b.title, token, expiresAt };
      window.opener?.postMessage(msg, window.location.origin);
      window.close();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('couldNotReachFreero'));
      setBusy(false);
    }
  }, []);

  if (!opened)
    return (
      <Card title={t('openThisFromFreero')}>
        <p>{t('thisWindowPicksABoard')}</p>
      </Card>
    );
  if (loading) return <Card title={t('chooseABoard')}><Spinner size={22} label={t('checkingYourSession')} /></Card>;
  if (!user)
    return (
      <Card title={t('signInToFreero')}>
        <p>{t('signInToChoose')}</p>
        <div className="fr-boarderror__actions">
          <Button variant="primary" onClick={() => signInFromWindow('login', false)}>{t('signIn')}</Button>
          <Button onClick={() => signInFromWindow('signup', false)}>{t('createAnAccount')}</Button>
        </div>
      </Card>
    );
  return (
    <div className="fr-hostpage">
      <div className="fr-hostpage__head">
        <Logo size={28} />
        <h1>{t('chooseABoard')}</h1>
      </div>
      <p className="fr-hostpage__lead">{t('everyoneSeesItAsShared')}</p>
      <BoardPicker onChoose={(b) => void choose(b)} busy={busy} />
      {error ? <p className="fr-hostpick__warn">{error}</p> : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
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
