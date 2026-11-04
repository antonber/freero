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
import { t } from './messages';
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
    // Recently opened first, then the rest of what they can edit.
    Promise.all([api.listBoards('recent'), api.listBoards('all')]).then(
      ([recent, all]) => {
        const seen = new Set<string>();
        const list = [...recent.boards, ...all.boards].filter((b) => (b.role === 'owner' || b.role === 'editor') && !seen.has(b.id) && !!seen.add(b.id));
        setBoards(list.slice(0, 12));
      },
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
      const { board } = await api.createBoard({ title: shared.title?.slice(0, 120) || t('sharedItems') });
      open(board.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('couldNotCreateABoard'));
      setBusy(false);
    }
  };

  return (
    <div className="fr-sharein">
      <div className="fr-sharein__card">
        <Logo size={28} withWordmark />
        <h1>{t('addToABoard')}</h1>
        {nothing ? (
          <p className="fr-sharein__note">{t('nothingArrivedThatFreeroCan')}</p>
        ) : (
          <div className="fr-sharein__what" aria-label={t('shared')}>
            {shared.images.map((src) => (
              <img key={src} src={src} alt="" />
            ))}
            {shared.link ? (
              <p className="fr-sharein__link">
                <Link2 size={16} aria-hidden /> <span>{shared.link}</span>
              </p>
            ) : null}
            {shared.text ? <p className="fr-sharein__text">{shared.text}</p> : null}
          </div>
        )}
        {shared.failed ? (
          <p className="fr-sharein__note">{t('failedFilesWerenTImages', { failed: shared.failed })}</p>
        ) : null}
        {error ? (
          <p className="fr-sharein__error" role="alert">
            {error}
          </p>
        ) : null}
        {nothing ? null : (
          <>
            <Button variant="primary" icon={Plus} loading={busy} onClick={() => void createAndOpen()}>{t('newBoard')}</Button>
            <h2>{t('orABoardYouCan')}</h2>
            {boards === null ? (
              <Spinner size={20} />
            ) : boards.length ? (
              <ul className="fr-sharein__boards">
                {boards.map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => open(b.id)} disabled={busy}>
                      {b.title || t('untitledBoard')}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="fr-sharein__note">{t('noBoardsYouCanEdit')}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
