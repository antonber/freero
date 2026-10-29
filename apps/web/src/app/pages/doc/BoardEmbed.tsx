// A live board (or frame) inside a doc (KAI-152). The doc stores only the address; each reader
// resolves it with THEIR access (the object registry) and, when they may see it, the board renders
// from its own doc over its own socket — which the server admits with that reader's access to the
// board, never the doc's. Anyone else sees a "No access" card with a way to ask for it.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Lock } from 'lucide-react';
import { parseObjectUri, type ResolvedObject } from '@freero/shared';
import { LiveBoardView, type LiveBoardStatus } from '@engine';
import { Button, useToast } from '@ui';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { createBoardInDocHost, toastNotify } from '../../board/host';
import { features } from '../../board/features';

export default function BoardEmbed({ uri }: { uri: string }) {
  const navigate = useNavigate();
  const notify = useToast();
  const { user } = useAuth();
  const ref = useMemo(() => parseObjectUri(uri), [uri]);
  const boardId = ref?.type === 'board' ? ref.id : ref?.type === 'element' ? ref.boardId : null;
  const frameId = ref?.type === 'element' ? ref.id : null;
  const [resolved, setResolved] = useState<ResolvedObject | null>(null);
  const [status, setStatus] = useState<LiveBoardStatus>('connecting');

  useEffect(() => {
    let cancelled = false;
    if (!boardId) return;
    api.resolveObjects([uri]).then(
      ({ objects }) => !cancelled && setResolved(objects[0] ?? { uri, status: 'unavailable' }),
      () => !cancelled && setResolved({ uri, status: 'unavailable' }),
    );
    return () => {
      cancelled = true;
    };
  }, [uri, boardId]);

  const host = useMemo(
    () => (user ? createBoardInDocHost({ user: { id: user.id, name: user.name, color: user.color, avatarUrl: user.avatarUrl }, navigate: (p) => navigate(p), notify: toastNotify(notify) }) : null),
    [user, navigate, notify],
  );
  const open = () => boardId && navigate(frameId ? `/board/${encodeURIComponent(boardId)}?item=${encodeURIComponent(frameId)}` : `/board/${encodeURIComponent(boardId)}`);

  if (!boardId) return <div className="fr-docpage-embed fr-docpage-embed--blocked">This embed’s address isn’t a Freero board.</div>;
  const denied = resolved?.status === 'unavailable' || resolved?.status === 'invalid' || status === 'denied' || status === 'removed';
  if (denied)
    return (
      <div className="fr-docpage-embed fr-docpage-embed--blocked" role="note">
        <Lock size={20} aria-hidden />
        <div>
          <strong>No access to this board</strong>
          <p>{status === 'removed' ? 'It was removed for review.' : 'You can ask its owner to let you in.'}</p>
        </div>
        {status !== 'removed' && (
          <Button size="sm" onClick={open}>
            Request access
          </Button>
        )}
      </div>
    );
  const title = resolved?.status === 'ok' ? resolved.object.title || (frameId ? 'Frame' : 'Board') : '';
  const boardTitle = resolved?.status === 'ok' ? (resolved.object.board?.title ?? resolved.object.title) : '';
  return (
    <figure className="fr-docpage-embed">
      <div className="fr-docpage-embed__view" onDoubleClick={open}>
        {resolved?.status === 'ok' && host ? <LiveBoardView boardId={boardId} frameId={frameId} host={host} features={features} onStatus={setStatus} label={`Live board: ${title}`} /> : null}
        {status === 'missing' && <div className="fr-docpage-embed__note">This frame is no longer on the board.</div>}
      </div>
      <figcaption className="fr-docpage-embed__bar">
        <span className="fr-docpage-embed__live" aria-hidden />
        <span className="fr-docpage-embed__title">{frameId && boardTitle && boardTitle !== title ? `${title} · ${boardTitle}` : title}</span>
        <Button size="sm" variant="ghost" icon={ExternalLink} onClick={open}>
          Open board
        </Button>
      </figcaption>
    </figure>
  );
}
