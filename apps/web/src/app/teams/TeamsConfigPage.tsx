// Route /teams/config — the configuration page of Freero's Teams tab (#112): Teams shows it when
// someone adds the app to a channel, a chat or a meeting, and saves what it sets (the tab's content
// page /teams/b/<id>). The board is picked by pasting its link, or from your boards in Teams' sign-in
// window (/teams/choose). Only a board whose owner allows embedding can be shown (the tab IS the
// board's embed): this page says so instead of saving a tab that would only show "can't be shown".
// No session here (it is a third-party frame): whatever it learns comes from the public embed info
// or from the chooser.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, LayoutGrid, Link2 } from 'lucide-react';
import type { TeamsChooseResult } from '@freero/shared';
import { Button, Input, Logo, Spinner } from '@ui';
import { api } from '../api/client';
import { saveEmbedToken } from '../embed/embedToken';
import { setThemeOverride } from '../lib/theme';
import { connectTeams, onTeamsConfigSave, onTeamsTheme, setTeamsConfig, setTeamsConfigValid, teamsLoaded, teamsSignInWindow, type TeamsInfo } from './teamsSdk';
import { t as tr } from '../messages';
import '../board/BoardPage.css';
import './teams.css';

type Pick = { id: string; title: string | null };
type Check = { state: 'idle' } | { state: 'checking' } | { state: 'ok'; pick: Pick } | { state: 'off' } | { state: 'bad' } | { state: 'error' };

/** The board a pasted link names, when it is a board link of this Freero (its app, embed or Teams page). */
export function boardIdFromLink(text: string, origin = window.location.origin): string | null {
  try {
    const u = new URL(text.trim());
    if (u.origin !== origin) return null;
    return /^\/(?:board|embed\/b|teams\/b)\/([A-Za-z0-9_-]{1,64})\/?$/.exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export default function TeamsConfigPage() {
  const [teams, setTeams] = useState<TeamsInfo | null | undefined>(undefined);
  const [link, setLink] = useState('');
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const chosen = useRef<Pick | null>(null);

  useEffect(() => {
    void connectTeams().then((t) => {
      setTeams(t);
      if (!t) return;
      setThemeOverride(t.theme);
      onTeamsTheme(setThemeOverride);
      // Teams asks for the tab when the person presses Save; only a checked board gets that far.
      onTeamsConfigSave(async () => {
        const pick = chosen.current;
        if (!pick) throw new Error('Choose a board first');
        const origin = window.location.origin;
        await setTeamsConfig({
          entityId: pick.id,
          contentUrl: `${origin}/teams/b/${encodeURIComponent(pick.id)}`,
          websiteUrl: `${origin}/board/${encodeURIComponent(pick.id)}`,
          suggestedDisplayName: (pick.title || 'Freero board').slice(0, 60),
        });
      });
      teamsLoaded();
    });
    return () => setThemeOverride(null);
  }, []);

  const accept = useCallback((next: Check) => {
    setCheck(next);
    chosen.current = next.state === 'ok' ? next.pick : null;
    void connectTeams().then((t) => t && setTeamsConfigValid(next.state === 'ok'));
  }, []);

  /** Whether the board may be shown in Teams at all: its embed must be on. */
  const checkBoard = useCallback(
    async (id: string, title: string | null) => {
      accept({ state: 'checking' });
      try {
        const info = await api.publicEmbed(id);
        accept(info.status === 'on' ? { state: 'ok', pick: { id, title: title ?? info.title } } : { state: 'off' });
      } catch {
        accept({ state: 'error' });
      }
    },
    [accept],
  );

  const onPaste = useCallback(
    (text: string) => {
      setLink(text);
      if (!text.trim()) return accept({ state: 'idle' });
      const id = boardIdFromLink(text);
      if (!id) return accept({ state: 'bad' });
      void checkBoard(id, null);
    },
    [accept, checkBoard],
  );

  const choose = useCallback(async () => {
    const raw = await teamsSignInWindow(`/teams/choose?client=${encodeURIComponent(teams?.client ?? 'web')}`, { width: 560, height: 720 });
    if (!raw) return;
    try {
      const r = JSON.parse(raw) as TeamsChooseResult;
      // The tab opens signed in for the person who added it (this frame and the tab share storage).
      if (r.token && r.expiresAt) saveEmbedToken(r.boardId, r.token, r.expiresAt);
      setLink(`${window.location.origin}/board/${r.boardId}`);
      await checkBoard(r.boardId, r.title);
    } catch {
      accept({ state: 'error' });
    }
  }, [teams, checkBoard, accept]);

  const status = useMemo(() => {
    switch (check.state) {
      case 'checking':
        return <Spinner size={18} label={tr('checkingTheBoard')} />;
      case 'ok':
        return <p className="fr-teams-ok">{check.pick.title ? tr('titleIsReadyPressSave', { title: check.pick.title }) : tr('thisBoardIsReadyPress')}</p>;
      case 'off':
        return <p className="fr-teams-warn">{tr('thisBoardCanTBe2')}</p>;
      case 'bad':
        return <p className="fr-teams-warn">{tr('thatIsnTALink', { host: window.location.host })}</p>;
      case 'error':
        return <p className="fr-teams-warn">{tr('freeroCouldnTBeReached')}</p>;
      default:
        return null;
    }
  }, [check]);

  if (teams === undefined) return <div className="fr-boarderror"><Spinner size={22} label={tr('connectingToTeams')} /></div>;
  if (teams === null)
    return (
      <div className="fr-boarderror">
        <div className="fr-boarderror__card">
          <Logo size={32} />
          <h1>{tr('addFreeroInMicrosoftTeams')}</h1>
          <p>{tr('thisPageSetsUpA')}</p>
          <div className="fr-boarderror__actions">
            <Button icon={ExternalLink} onClick={() => void window.open('/app', '_blank', 'noopener')}>{tr('openFreero')}</Button>
          </div>
        </div>
      </div>
    );
  return (
    <div className="fr-teams-config">
      <div className="fr-teams-config__head">
        <Logo size={28} />
        <h1>{tr('showAFreeroBoardHere')}</h1>
      </div>
      <p className="fr-teams-config__lead">Everyone here sees the board as Freero shares it with them: people it’s shared with sign in once to edit or comment; others see it only if anyone with the link may view it.</p>
      <Button variant="primary" icon={LayoutGrid} onClick={() => void choose()}>{tr('chooseFromYourBoards')}</Button>
      <div className="fr-teams-config__or">{tr('or')}</div>
      <Input label={tr('pasteABoardLink')} icon={Link2} placeholder={tr('originBoard', { origin: window.location.origin })} value={link} onChange={(e) => onPaste(e.target.value)} />
      <div className="fr-teams-config__status" aria-live="polite">
        {status}
      </div>
    </div>
  );
}
