// Route /zoom/home — the Freero Zoom App's home (#168), in the meeting's app panel. When the meeting
// already has a board (a host invited everyone to it), it opens that board. Otherwise it picks one:
// in Zoom's own browser, which keeps its own Freero session, from your boards right here (sign in in
// this window first); in Zoom's web client, which frames the app, through Freero's chooser window or
// a pasted link.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, LogIn } from 'lucide-react';
import type { BoardSummary } from '@freero/shared';
import { Button, Logo, Spinner } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { saveEmbedToken } from '../../embed/embedToken';
import { loginPath } from '../../lib/nav';
import { BoardPicker } from '../BoardPicker';
import { LinkOrChoose, type ChosenBoard } from '../LinkOrChoose';
import { t } from '../messages';
import { connectZoom, zoomMeetingUuid, zoomOpenUrl, type ZoomInfo } from './zoomSdk';
import '../../board/BoardPage.css';
import '../hosts.css';

export default function ZoomHomePage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [zoom, setZoom] = useState<ZoomInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picking = new URLSearchParams(window.location.search).get('pick') === '1';
  const open = useCallback((id: string) => navigate(`/zoom/b/${encodeURIComponent(id)}`, { replace: true }), [navigate]);

  useEffect(() => {
    let live = true;
    void connectZoom().then(async (z) => {
      if (!live) return;
      // The board the meeting's host opened for everyone, unless the person asked for another.
      const uuid = z && !picking ? await zoomMeetingUuid() : null;
      const shared = uuid ? await api.zoomMeetingBoard(uuid).then((r) => r.boardId, () => null) : null;
      if (!live) return;
      if (shared) return open(shared);
      setZoom(z);
    });
    return () => {
      live = false;
    };
  }, [open, picking]);

  const chooseHere = useCallback(
    async (b: BoardSummary) => {
      setBusy(true);
      setError(null);
      try {
        const { token, expiresAt } = await api.publicEmbedToken(b.id, false);
        saveEmbedToken(b.id, token, expiresAt);
        open(b.id);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : t('couldNotReachFreero'));
        setBusy(false);
      }
    },
    [open],
  );

  if (zoom === undefined || loading) return <Shell><Spinner size={22} label={t('connectingToZoom')} /></Shell>;
  if (zoom === null)
    return (
      <Shell title={t('openFreeroInZoom')}>
        <p>{t('openFreeroInZoomText')}</p>
        <div className="fr-boarderror__actions">
          <Button icon={ExternalLink} onClick={() => void window.open('/app', '_blank', 'noopener')}>{t('openFreero')}</Button>
        </div>
      </Shell>
    );

  const head = (
    <div className="fr-hostpage__head">
      <Logo size={28} />
      <h1>{t('showABoardInMeeting')}</h1>
    </div>
  );
  // Zoom's web client: a frame of zoom.us, without the session.
  if (zoom.framed)
    return (
      <div className="fr-hostpage">
        {head}
        <p className="fr-hostpage__lead">{t('everyoneSeesItAsShared')}</p>
        <LinkOrChoose onReady={(b: ChosenBoard) => open(b.id)} />
      </div>
    );
  // Zoom's own browser: its own Freero session.
  if (!user)
    return (
      <div className="fr-hostpage">
        {head}
        <p className="fr-hostpage__lead">{t('signInZoomHint')}</p>
        <div className="fr-hostpage__row">
          <Button variant="primary" icon={LogIn} onClick={() => window.location.assign(loginPath('/zoom/home'))}>{t('signIn')}</Button>
          <Button onClick={() => window.location.assign(loginPath('/zoom/home', 'signup'))}>{t('createAnAccount')}</Button>
          <Button variant="ghost" icon={ExternalLink} onClick={() => void zoomOpenUrl(`${window.location.origin}/app`)}>{t('openFreero')}</Button>
        </div>
      </div>
    );
  return (
    <div className="fr-hostpage">
      {head}
      <p className="fr-hostpage__lead">{t('everyoneSeesItAsShared')}</p>
      <BoardPicker onChoose={(b) => void chooseHere(b)} busy={busy} />
      {error ? <p className="fr-hostpick__warn">{error}</p> : null}
    </div>
  );
}

function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card">
        <Logo size={32} />
        {title ? <h1>{title}</h1> : null}
        {children}
      </div>
    </div>
  );
}
