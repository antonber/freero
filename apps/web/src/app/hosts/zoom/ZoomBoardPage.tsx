// Route /zoom/b/:id — a Freero board in a Zoom meeting (#168): the public embed (PublicEmbed) with
// Zoom around it. Each person sees the board as Freero shares it with them; a board anyone with its
// link may view shows read-only to people without an account. Signing in: in Zoom's own browser
// (its own Freero session) the board's token is minted right here, after signing in in this window;
// in Zoom's web client (a frame of zoom.us, no session) through Freero's sign-in window. Hosts and
// co-hosts get "Invite everyone": the meeting records this board and Zoom invites everyone, whose
// app then opens the same board. Only Zoom can frame this page (the server allows no other ancestor),
// and in Zoom's own browser it is the top-level page, so editing starts at once.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LayoutGrid, Send } from 'lucide-react';
import { EMBED_NO_ACCESS } from '@freero/shared';
import { Button, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { FullPageSpinner } from '../../components/FullPageSpinner';
import { readEmbedToken } from '../../embed/embedToken';
import { PublicEmbed, popupSignIn, type EmbedSignIn } from '../../embed/PublicEmbedPage';
import { loginPath } from '../../lib/nav';
import { t } from '../messages';
import { connectZoom, zoomInviteEveryone, zoomMayInvite, zoomMeetingUuid, type ZoomInfo } from './zoomSdk';

/** Sign in for one board in Zoom's own browser: its session mints the token, or the person signs in in this window first. */
async function signInHere(boardId: string, readonly: boolean): Promise<EmbedSignIn> {
  try {
    const { token, expiresAt } = await api.publicEmbedToken(boardId, readonly);
    return { token, expiresAt };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      window.location.assign(loginPath(`/zoom/b/${encodeURIComponent(boardId)}`));
      return null;
    }
    if (e instanceof ApiError && (e.code === EMBED_NO_ACCESS || e.status === 403)) return 'no-access';
    return null;
  }
}

export default function ZoomBoardPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [zoom, setZoom] = useState<ZoomInfo | null | undefined>(undefined);
  const [mayInvite, setMayInvite] = useState(false);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    let live = true;
    void connectZoom().then(async (z) => {
      if (!live) return;
      setZoom(z);
      if (z && (z.context === 'inMeeting' || z.context === 'inWebinar')) setMayInvite(await zoomMayInvite());
    });
    return () => {
      live = false;
    };
  }, []);

  const invite = useCallback(async () => {
    const uuid = await zoomMeetingUuid();
    if (!uuid) return toast(t('couldNotInvite'), 'error');
    setInviting(true);
    try {
      // Framed in the web client there is no session: the board's own token says who opens it.
      await api.zoomSetMeetingBoard(uuid, id, readEmbedToken(id) ?? undefined);
      const sent = await zoomInviteEveryone();
      toast(sent ? t('invitationSent') : t('couldNotInvite'), sent ? 'success' : 'error');
    } catch (e) {
      toast(e instanceof ApiError && e.status === 401 ? t('signInToInvite') : t('couldNotInvite'), 'error');
    } finally {
      setInviting(false);
    }
  }, [id, toast]);

  if (zoom === undefined) return <FullPageSpinner label={t('openTheBoard')} />;
  const extra = (
    <>
      {mayInvite ? (
        <Button size="sm" variant="ghost" icon={Send} loading={inviting} onClick={() => void invite()}>{t('inviteEveryone')}</Button>
      ) : null}
      {zoom ? (
        <Button size="sm" variant="ghost" icon={LayoutGrid} onClick={() => navigate('/zoom/home?pick=1')}>{t('otherBoard')}</Button>
      ) : null}
    </>
  );
  return <PublicEmbed id={id} readonly={false} theme="light" signIn={zoom?.framed === false ? signInHere : popupSignIn} editDirectly={zoom !== null} extra={extra} />;
}
