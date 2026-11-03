// Route /teams/choose[?client=web|desktop|…] — "Choose from your boards" of the Teams tab's
// configuration page (#112). Teams opens it in its own sign-in window (authentication.authenticate),
// so it is Freero's own first-party page with the person's session: they sign in if needed, pick a
// board of one of their workspaces, and it goes back to the configuration page through the Teams
// JavaScript library (authentication.notifySuccess, Teams' origins only) — with a token for the
// board's embeds, so the new tab opens signed in for them. Only boards that can be shown in Teams
// (embedding on) can be picked; the owner can turn embedding on right here.
// The server keeps window.opener for this path (Teams on the web talks to it through it).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import type { BoardSummary, TeamsChooseResult, WorkspaceSummary } from '@freero/shared';
import { Button, Input, Logo, Select, Spinner } from '@ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { signInFromWindow } from '../embed/EmbedConnectPage';
import { connectTeams, finishTeamsSignIn, type TeamsInfo } from './teamsSdk';
import '../board/BoardPage.css';
import './teams.css';

type Embedding = 'checking' | 'on' | 'off' | 'error';

export default function TeamsChoosePage() {
  const params = new URLSearchParams(window.location.search);
  const signInHere = params.get('client') !== 'web';
  const { user, loading, refresh } = useAuth();
  const [teams, setTeams] = useState<TeamsInfo | null | undefined>(undefined);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [q, setQ] = useState('');
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [picked, setPicked] = useState<BoardSummary | null>(null);
  const [embedding, setEmbedding] = useState<Embedding>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => void connectTeams().then(setTeams), []);
  // Signed in in another tab: pick the session up when this window gets focus back.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    void api.listWorkspaces().then(({ workspaces: w }) => {
      setWorkspaces(w);
      setWorkspace((cur) => cur || w[0]?.id || '');
    });
  }, [userId]);

  useEffect(() => {
    if (!userId || !workspace) return;
    let live = true;
    setBoards(null);
    const t = setTimeout(
      () =>
        void api.listBoards('all', q, { workspace }).then(
          ({ boards: b }) => live && setBoards(b.filter((x) => x.kind === 'board')),
          () => live && setBoards([]),
        ),
      q ? 250 : 0,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [userId, workspace, q]);

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
    setBusy(true);
    setError(null);
    try {
      await api.updateBoard(picked.id, { embeddable: true });
      setEmbedding('on');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach Freero.');
    } finally {
      setBusy(false);
    }
  }, [picked]);

  const done = useCallback(async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const { token, expiresAt } = await api.publicEmbedToken(picked.id, false);
      const result: TeamsChooseResult = { boardId: picked.id, title: picked.title, token, expiresAt };
      finishTeamsSignIn(JSON.stringify(result));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach Freero.');
      setBusy(false);
    }
  }, [picked]);

  const options = useMemo(() => workspaces.map((w) => ({ value: w.id, label: w.name })), [workspaces]);

  if (teams === undefined || loading) return <Shell><Spinner size={22} label="Connecting to Teams" /></Shell>;
  if (teams === null)
    return (
      <Shell title="Open this from Microsoft Teams">
        <p>This window picks a Freero board for a Teams tab. Use “Choose from your boards” when you add Freero in Teams.</p>
      </Shell>
    );
  if (!user)
    return (
      <Shell title="Sign in to Freero">
        <p>Sign in to choose one of your boards for Teams.{signInHere ? '' : ' A new tab opens; come back here when you’re signed in.'}</p>
        <div className="fr-boarderror__actions">
          <Button variant="primary" onClick={() => signInFromWindow('login', signInHere)}>
            Sign in
          </Button>
          <Button onClick={() => signInFromWindow('signup', signInHere)}>Create an account</Button>
        </div>
      </Shell>
    );

  const owner = picked?.role === 'owner';
  return (
    <div className="fr-teams-choose">
      <div className="fr-teams-config__head">
        <Logo size={28} />
        <h1>Choose a board for Teams</h1>
      </div>
      <div className="fr-teams-choose__filters">
        {options.length > 1 ? <Select value={workspace} options={options} onChange={(v) => setWorkspace(v)} aria-label="Workspace" /> : null}
        <Input icon={Search} placeholder="Search your boards" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search your boards" />
      </div>
      <ul className="fr-teams-choose__list" aria-label="Your boards">
        {boards === null ? (
          <li className="fr-teams-choose__empty">
            <Spinner size={18} label="Loading your boards" />
          </li>
        ) : boards.length === 0 ? (
          <li className="fr-teams-choose__empty">{q ? 'No boards match.' : 'No boards here yet.'}</li>
        ) : (
          boards.map((b) => (
            <li key={b.id}>
              <button type="button" className={`fr-teams-choose__item${picked?.id === b.id ? ' is-picked' : ''}`} aria-pressed={picked?.id === b.id} onClick={() => void pick(b)}>
                <span className="fr-teams-choose__title">{b.title || 'Untitled board'}</span>
                <span className="fr-teams-choose__meta">{b.ownerName}</span>
                {picked?.id === b.id ? <Check size={16} aria-hidden /> : null}
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="fr-teams-choose__foot" aria-live="polite">
        {picked && embedding === 'checking' ? <Spinner size={18} label="Checking the board" /> : null}
        {picked && embedding === 'off' ? (
          <p className="fr-teams-warn">
            {owner ? 'Teams shows a board through its embed, which is off for this board. Turn it on? What people see still follows the board’s sharing.' : 'Its owner hasn’t turned on Embed for this board, so it can’t be shown in Teams. Ask them to turn it on in the board’s Share dialog.'}
          </p>
        ) : null}
        {picked && embedding === 'error' ? <p className="fr-teams-warn">Freero couldn’t be reached. Try again.</p> : null}
        {error ? <p className="fr-teams-warn">{error}</p> : null}
        <div className="fr-boarderror__actions">
          {picked && embedding === 'off' && owner ? (
            <Button loading={busy} onClick={() => void turnOnEmbedding()}>
              Turn on embedding
            </Button>
          ) : null}
          <Button variant="primary" loading={busy && embedding === 'on'} disabled={!picked || embedding !== 'on'} onClick={() => void done()}>
            Use this board
          </Button>
        </div>
      </div>
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
