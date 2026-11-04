// Choosing one of your boards for an app on another platform (#168, #169): the Zoom App's home in
// Zoom's own browser, and the chooser window (/embed/choose) the Google Meet side panel and Zoom's web
// client open. It runs where the person's session is (first party): their workspaces and boards,
// and only boards that can be shown there (embedding on) can be used; the owner can turn embedding
// on right here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import type { BoardSummary, EmbedChooseMessage, WorkspaceSummary } from '@freero/shared';
import { Button, Input, Select, Spinner } from '@ui';
import { api, ApiError } from '../api/client';
import { t } from './messages';
import './hosts.css';

type Embedding = 'checking' | 'on' | 'off' | 'error';

export function BoardPicker({ onChoose, busy }: { onChoose: (board: BoardSummary) => void; busy?: boolean }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [q, setQ] = useState('');
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [picked, setPicked] = useState<BoardSummary | null>(null);
  const [embedding, setEmbedding] = useState<Embedding>('checking');
  const [turningOn, setTurningOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.listWorkspaces().then(({ workspaces: w }) => {
      setWorkspaces(w);
      setWorkspace((cur) => cur || w[0]?.id || '');
    });
  }, []);

  useEffect(() => {
    if (!workspace) return;
    let live = true;
    setBoards(null);
    const timer = setTimeout(
      () =>
        void api.listBoards('all', q, { workspace }).then(
          ({ boards: b }) => live && setBoards(b.filter((x) => x.kind === 'board')),
          () => live && setBoards([]),
        ),
      q ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [workspace, q]);

  const pick = useCallback(async (b: BoardSummary) => {
    setPicked(b);
    setError(null);
    setEmbedding('checking');
    try {
      setEmbedding((await api.publicEmbed(b.id)).status === 'on' ? 'on' : 'off');
    } catch {
      setEmbedding('error');
    }
  }, []);

  const turnOnEmbedding = useCallback(async () => {
    if (!picked) return;
    setTurningOn(true);
    setError(null);
    try {
      await api.updateBoard(picked.id, { embeddable: true });
      setEmbedding('on');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('couldNotReachFreero'));
    } finally {
      setTurningOn(false);
    }
  }, [picked]);

  const options = useMemo(() => workspaces.map((w) => ({ value: w.id, label: w.name })), [workspaces]);
  const owner = picked?.role === 'owner';
  return (
    <div className="fr-hostpick">
      <div className="fr-hostpick__filters">
        {options.length > 1 ? <Select value={workspace} options={options} onChange={(v) => setWorkspace(v)} aria-label={t('workspace')} /> : null}
        <Input icon={Search} placeholder={t('searchYourBoards')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('searchYourBoards')} />
      </div>
      <ul className="fr-hostpick__list" aria-label={t('yourBoards')}>
        {boards === null ? (
          <li className="fr-hostpick__empty">
            <Spinner size={18} label={t('loadingYourBoards')} />
          </li>
        ) : boards.length === 0 ? (
          <li className="fr-hostpick__empty">{q ? t('noBoardsMatch') : t('noBoardsHereYet')}</li>
        ) : (
          boards.map((b) => (
            <li key={b.id}>
              <button type="button" className={`fr-hostpick__item${picked?.id === b.id ? ' is-picked' : ''}`} aria-pressed={picked?.id === b.id} onClick={() => void pick(b)}>
                <span className="fr-hostpick__title">{b.title || t('untitledBoard')}</span>
                <span className="fr-hostpick__meta">{b.ownerName}</span>
                {picked?.id === b.id ? <Check size={16} aria-hidden /> : null}
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="fr-hostpick__foot" aria-live="polite">
        {picked && embedding === 'checking' ? <Spinner size={18} label={t('checkingTheBoard')} /> : null}
        {picked && embedding === 'off' ? <p className="fr-hostpick__warn">{owner ? t('embeddingOffOwner') : t('embeddingOffOther')}</p> : null}
        {picked && embedding === 'error' ? <p className="fr-hostpick__warn">{t('couldNotReachFreero')}</p> : null}
        {error ? <p className="fr-hostpick__warn">{error}</p> : null}
        <div className="fr-boarderror__actions">
          {picked && embedding === 'off' && owner ? (
            <Button loading={turningOn} onClick={() => void turnOnEmbedding()}>{t('turnOnEmbedding')}</Button>
          ) : null}
          <Button variant="primary" loading={busy} disabled={!picked || embedding !== 'on'} onClick={() => picked && onChoose(picked)}>{t('useThisBoard')}</Button>
        </div>
      </div>
    </div>
  );
}

/** How choosing in a window ended: the board (and a token for it), the window couldn't open, or nothing (closed). */
export type WindowChoice = EmbedChooseMessage | 'blocked' | null;

/**
 * From a Freero frame on another platform (no session there): opens the chooser window
 * (/embed/choose, first party, with the session) and waits for the board it posts back. Only a
 * message from that window, of Freero's own origin, is listened to.
 */
export function chooseInWindow(): Promise<WindowChoice> {
  const w = window.open('/embed/choose', 'freero-embed-choose', 'popup,width=560,height=720');
  if (!w) return Promise.resolve('blocked');
  w.focus();
  return new Promise((resolve) => {
    const done = (out: WindowChoice) => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(watch);
      resolve(out);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== w) return;
      const d = e.data as EmbedChooseMessage | null;
      if (d && typeof d === 'object' && d.freeroEmbedChoose === 'board' && typeof d.boardId === 'string') done(d);
    };
    const watch = window.setInterval(() => w.closed && done(null), 500);
    window.addEventListener('message', onMessage);
  });
}

/** The board a pasted link names, when it is a link to a board of this Freero (any of its board pages). */
export function boardIdFromLink(text: string, origin = window.location.origin): string | null {
  try {
    const u = new URL(text.trim());
    if (u.origin !== origin) return null;
    return /^\/(?:board|embed\/b|teams\/b|atlassian\/b|zoom\/b|meet\/stage)\/([A-Za-z0-9_-]{1,64})\/?$/.exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}
