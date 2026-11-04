// "Choose from your boards, or paste a board link" for the apps on other platforms whose page has no
// session (a frame of another site): the chooser window, or a pasted link checked against the
// board's embed (it must allow embedding to be shown there).
import { useCallback, useState } from 'react';
import { LayoutGrid, Link2 } from 'lucide-react';
import { Button, Input, Spinner } from '@ui';
import { api } from '../api/client';
import { saveEmbedToken } from '../embed/embedToken';
import { boardIdFromLink, chooseInWindow } from './BoardPicker';
import { t } from './messages';

export interface ChosenBoard {
  id: string;
  title: string | null;
}

type Check = 'idle' | 'checking' | 'off' | 'bad' | 'error' | 'blocked';

export function LinkOrChoose({ onReady }: { onReady: (board: ChosenBoard) => void }) {
  const [link, setLink] = useState('');
  const [check, setCheck] = useState<Check>('idle');

  const checkBoard = useCallback(
    async (id: string, title: string | null) => {
      setCheck('checking');
      try {
        const info = await api.publicEmbed(id);
        if (info.status !== 'on') return setCheck('off');
        setCheck('idle');
        onReady({ id, title: title ?? info.title });
      } catch {
        setCheck('error');
      }
    },
    [onReady],
  );

  const choose = useCallback(async () => {
    const out = await chooseInWindow();
    if (out === 'blocked') return setCheck('blocked');
    if (!out) return;
    // This frame opens the board signed in for the person who chose it (the window minted its token).
    saveEmbedToken(out.boardId, out.token, out.expiresAt);
    await checkBoard(out.boardId, out.title);
  }, [checkBoard]);

  const onPaste = useCallback(
    (text: string) => {
      setLink(text);
      if (!text.trim()) return setCheck('idle');
      const id = boardIdFromLink(text);
      if (!id) return setCheck('bad');
      void checkBoard(id, null);
    },
    [checkBoard],
  );

  return (
    <>
      <Button variant="primary" icon={LayoutGrid} onClick={() => void choose()}>{t('chooseFromYourBoards')}</Button>
      <div className="fr-hostpage__or">{t('or')}</div>
      <Input label={t('pasteABoardLink')} icon={Link2} placeholder={t('originBoard', { origin: window.location.origin })} value={link} onChange={(e) => onPaste(e.target.value)} />
      <div aria-live="polite">
        {check === 'checking' ? <Spinner size={18} label={t('checkingTheBoard')} /> : null}
        {check === 'off' ? <p className="fr-hostpick__warn">{t('boardCantBeShown')}</p> : null}
        {check === 'bad' ? <p className="fr-hostpick__warn">{t('thatIsntALink', { host: window.location.host })}</p> : null}
        {check === 'error' ? <p className="fr-hostpick__warn">{t('couldNotReachFreero')}</p> : null}
        {check === 'blocked' ? <p className="fr-hostpick__warn">{t('popupBlockedText')}</p> : null}
      </div>
    </>
  );
}
