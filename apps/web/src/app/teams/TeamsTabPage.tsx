// Route /teams/b/:id — a Freero board in Microsoft Teams (#112): a channel or chat tab, a meeting's
// chat tab and details, its side panel and its stage. It is the public embed (#2, PublicEmbed) with
// Teams around it: the server lets Teams — and only Teams — frame it while the board allows
// embedding, and what each person sees follows the board's sharing exactly (a public board read-only
// for everyone; anyone else signs in once, in Teams' own sign-in window, and gets their own role).
//
// - Theme: Teams' (default, dark, high contrast), live.
// - Editing starts at once for people who may edit: only Teams can frame this page, so there is no
//   other site to hide it under (the plain embed waits for a click on an uncovered frame).
// - Meeting side panel: "Share to stage" for organisers and presenters shows the board on the
//   meeting stage for everyone (each participant's own access applies there too).
// Outside Teams (opened directly), it behaves like the plain embed.
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MonitorUp } from 'lucide-react';
import type { TeamsSignInResult } from '@freero/shared';
import { Button, useToast } from '@ui';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { PublicEmbed, popupSignIn, type EmbedSignIn } from '../embed/PublicEmbedPage';
import type { ColorTheme } from '../lib/theme';
import { canShareToStage, connectTeams, onTeamsTheme, shareToStage, teamsLoaded, teamsSignInWindow, type TeamsInfo } from './teamsSdk';

/** Sign in for one board through Teams' sign-in window (the embed's own sign-in page, Teams mode). */
export function teamsBoardSignIn(client: string) {
  return async (boardId: string, readonly: boolean): Promise<EmbedSignIn> => {
    const q = new URLSearchParams({ teams: '1', client });
    if (readonly) q.set('readonly', '1');
    const raw = await teamsSignInWindow(`/embed/connect/${encodeURIComponent(boardId)}?${q}`);
    if (!raw) return null;
    try {
      const r = JSON.parse(raw) as TeamsSignInResult;
      if (r.boardId !== boardId) return null;
      return r.kind === 'token' ? { token: r.token, expiresAt: r.expiresAt } : 'no-access';
    } catch {
      return null;
    }
  };
}

export default function TeamsTabPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [teams, setTeams] = useState<TeamsInfo | null | undefined>(undefined);
  const [theme, setTheme] = useState<ColorTheme>('light');
  const [mayShare, setMayShare] = useState(false);

  useEffect(() => {
    let live = true;
    void connectTeams().then((t) => {
      if (!live) return;
      setTeams(t);
      if (!t) return;
      setTheme(t.theme);
      onTeamsTheme(setTheme);
      teamsLoaded();
      if (t.surface === 'sidePanel') void canShareToStage().then((ok) => live && setMayShare(ok));
    });
    return () => {
      live = false;
    };
  }, []);

  const share = useCallback(async () => {
    const ok = await shareToStage(`${window.location.origin}/teams/b/${encodeURIComponent(id)}`);
    if (!ok) toast('Teams didn’t share the board to the stage. Only organisers and presenters can share.', 'error');
  }, [id, toast]);

  if (teams === undefined) return <FullPageSpinner label="Opening board" />;
  const extra = mayShare ? (
    <Button size="sm" variant="ghost" icon={MonitorUp} onClick={() => void share()}>
      Share to stage
    </Button>
  ) : null;
  return <PublicEmbed id={id} readonly={false} theme={theme} signIn={teams ? teamsBoardSignIn(teams.client) : popupSignIn} editDirectly={teams !== null} extra={extra} />;
}
