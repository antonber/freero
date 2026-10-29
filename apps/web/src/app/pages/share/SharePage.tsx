// Where the system share sheet lands (KAI-218): the server's share target stored the shared images
// with this person's uploads and sent the browser here with them, the link and the text. Pick a
// board (or start a new one) and it opens with them placed (features/share, Host.takeShared).
import { useEffect, useMemo, useState } from 'react';
import { Link2, Plus } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { BoardSummary } from '@freero/shared';
import { Button, Logo, Spinner } from '@ui';
import { api, ApiError } from '../../api/client';
import { holdShare, sharedFromQuery } from '../../lib/pendingShare';
import './share.css';

export function SharePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const shared = useMemo(() => sharedFromQuery(params), [params]);
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error'));

  useEffect(() => {
    document.title = 'Add to a board · Freero';
    api.listBoards('recent').then(
      (r) => setBoards(r.boards.filter((b) => b.role === 'owner' || b.role === 'editor').slice(0, 12)),
      () => setBoards([]),
    );
  }, []);

  const nothing = !shared.images.length && !shared.link && !shared.text;
  const open = (boardId: string) => {
    holdShare(boardId, { images: shared.images, link: shared.link, text: shared.text, title: shared.title });
    navigate(`/board/${boardId}?shared=1`);
  };
  const createAndOpen = async () => {
    setBusy(true);
    try {
      const { board } = await api.createBoard({ title: shared.title?.slice(0, 120) || 'Shared items' });
      open(board.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create a board');
      setBusy(false);
    }
  };

  return (
    <div className="fr-share">
      <div className="fr-share__card">
        <Logo size={28} withWordmark />
        <h1>Add to a board</h1>
        {nothing ? (
          <p className="fr-share__note">Nothing arrived that Freero can place: share images, a link or text.</p>
        ) : (
          <div className="fr-share__what" aria-label="Shared">
            {shared.images.map((src) => (
              <img key={src} src={src} alt="" />
            ))}
            {shared.link ? (
              <p className="fr-share__link">
                <Link2 size={16} aria-hidden /> <span>{shared.link}</span>
              </p>
            ) : null}
            {shared.text ? <p className="fr-share__text">{shared.text}</p> : null}
          </div>
        )}
        {shared.failed ? (
          <p className="fr-share__note">
            {shared.failed === 1 ? 'One file wasn’t an image Freero could store' : `${shared.failed} files weren’t images Freero could store`} (or your upload quota is full).
          </p>
        ) : null}
        {error ? (
          <p className="fr-share__error" role="alert">
            {error}
          </p>
        ) : null}
        {nothing ? null : (
          <>
            <Button variant="primary" icon={Plus} loading={busy} onClick={() => void createAndOpen()}>
              New board
            </Button>
            <h2>Or a board you edit recently</h2>
            {boards === null ? (
              <Spinner size={20} />
            ) : boards.length ? (
              <ul className="fr-share__boards">
                {boards.map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => open(b.id)} disabled={busy}>
                      {b.title || 'Untitled board'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="fr-share__note">No boards you can edit yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
