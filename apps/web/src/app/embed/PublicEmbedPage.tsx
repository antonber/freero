// Route /embed/b/:id[?readonly=1][&frame=<itemId>] — a board embedded live on another site (#2;
// docs/integrations/embedding.md). The server lets other sites frame this page only while the
// board's owner and its workspace allow it (modules/embed); what it shows follows the board's
// sharing exactly:
// - a visitor without an account sees a public board live, read-only (and no one sees them);
// - anyone else signs in through a first-party popup (EmbedConnectPage), which hands this frame a
//   token for THIS board (kept in this site's partition of storage until it expires);
// - someone who may edit starts EDITING only with a click here, and only while the frame isn't
//   covered (where the browser can tell): a page framing the board can't trick a signed-in
//   person's clicks into edits they don't see. Until then the socket only reads.
// Nothing here navigates the frame: links open Freero in a new tab.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { ExternalLink, LogIn, Pencil, Eye } from 'lucide-react';
import { WS_CLOSE_EMBED_FULL, type EmbedConnectMessage, type PublicEmbedInfo, type Role } from '@freero/shared';
import { BoardEngine, type Host } from '@engine';
import { Button, Logo, useToast } from '@ui';
import { api, ApiError } from '../api/client';
import { features } from '../board/features';
import { createPublicEmbedHost, toastNotify, type PublicEmbedView } from '../board/host';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { forgetEmbedToken, readEmbedToken, saveEmbedToken } from './embedToken';
import { frameIsUncovered } from './visibility';
import '../board/BoardPage.css';
import './PublicEmbedPage.css';
import { embedTheme, setThemeOverride } from '../lib/theme';

type Card = 'off' | 'signin' | 'no-access' | 'full' | 'popup-blocked' | 'error';
type State = { status: 'loading' } | { status: 'card'; card: Card; info?: PublicEmbedInfo } | { status: 'live'; view: PublicEmbedView };

const VISITOR = { id: 'visitor', name: 'Visitor', color: '#8a8f98', avatarUrl: null };
const canWrite = (role: Role) => role !== 'viewer';

export default function PublicEmbedPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const readonly = new URLSearchParams(location.search).get('readonly') === '1';
  const notify = useToast();
  const toast = useMemo(() => toastNotify(notify), [notify]);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [info, setInfo] = useState<PublicEmbedInfo | null>(null);
  // The embedding page's look, not this browser's choice: light unless it asks ?theme=dark.
  useEffect(() => {
    setThemeOverride(embedTheme() ?? 'light');
    return () => setThemeOverride(null);
  }, []);
  const [editing, setEditing] = useState(false);
  const boardUrl = info?.status === 'on' ? info.boardUrl : `${window.location.origin}/board/${encodeURIComponent(id)}`;
  const openInFreero = useCallback(() => void window.open(boardUrl, '_blank', 'noopener'), [boardUrl]);

  /** Shows the board for the person behind `token`; false when the token no longer works. */
  const showAsMember = useCallback(
    async (token: string): Promise<boolean> => {
      try {
        const m = await api.publicEmbedMember(id, token);
        const role = readonly ? 'viewer' : m.board.role;
        setEditing(false);
        setState({ status: 'live', view: { board: { ...m.board, role }, user: m.user, token, viewOnly: true, boardUrl: m.boardUrl } });
        return true;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 404)) forgetEmbedToken(id);
        return false;
      }
    },
    [id, readonly],
  );

  const showAsVisitor = useCallback((i: Extract<PublicEmbedInfo, { status: 'on' }>) => {
    setState({ status: 'live', view: { board: { id: i.boardId, title: i.title ?? '', role: 'viewer' }, user: VISITOR, token: null, viewOnly: true, boardUrl: i.boardUrl } });
  }, []);

  const start = useCallback(async () => {
    setState({ status: 'loading' });
    let i: PublicEmbedInfo;
    try {
      i = await api.publicEmbed(id);
    } catch {
      return setState({ status: 'card', card: 'error' });
    }
    setInfo(i);
    if (i.status === 'off') return setState({ status: 'card', card: 'off', info: i });
    const saved = readEmbedToken(id);
    if (saved && (await showAsMember(saved))) return;
    if (i.visitor) return showAsVisitor(i);
    setState({ status: 'card', card: 'signin', info: i });
  }, [id, showAsMember, showAsVisitor]);

  useEffect(() => void start(), [start]);

  // Sign in: Freero's own page in a popup (first-party, so the person's session is there), which
  // posts this frame a token for this board. Only a window of Freero's own origin is listened to.
  const popup = useRef<Window | null>(null);
  const signIn = useCallback(() => {
    const q = new URLSearchParams();
    if (readonly) q.set('readonly', '1');
    const host = embedderHost();
    if (host) q.set('site', host);
    const w = window.open(`/embed/connect/${encodeURIComponent(id)}${q.size ? `?${q}` : ''}`, 'freero-embed-connect', 'popup,width=480,height=680');
    if (!w) return setState({ status: 'card', card: 'popup-blocked', info: info ?? undefined });
    popup.current = w;
    w.focus();
  }, [id, readonly, info]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || !popup.current || e.source !== popup.current) return;
      const d = e.data as EmbedConnectMessage | null;
      if (!d || typeof d !== 'object' || !('freeroEmbedConnect' in d) || d.boardId !== id) return;
      popup.current = null;
      if (d.freeroEmbedConnect === 'no-access') return setState({ status: 'card', card: 'no-access', info: info ?? undefined });
      saveEmbedToken(id, d.token, d.expiresAt);
      void showAsMember(d.token).then((ok) => ok || setState({ status: 'card', card: 'error' }));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [id, info, showAsMember]);

  const view = state.status === 'live' ? state.view : null;
  const onConnectionEnded = useCallback(
    ({ code }: { code: number }) => {
      if (code === WS_CLOSE_EMBED_FULL) return setState({ status: 'card', card: 'full' });
      // Signed out, access or embedding gone: start over (it shows what is still possible).
      if (view?.token) forgetEmbedToken(id);
      void start();
    },
    [id, start, view?.token],
  );

  const startEditing = useCallback(async () => {
    if (!(await frameIsUncovered(document.documentElement))) {
      toast('Part of this board is covered on this page, so editing stays off here. Open it in Freero to edit.', 'error');
      return;
    }
    setEditing(true);
  }, [toast]);

  const host = useMemo<Host | null>(() => {
    if (!view) return null;
    return createPublicEmbedHost({ ...view, viewOnly: !editing }, { notify: toast, onConnectionEnded });
  }, [view, editing, toast, onConnectionEnded]);

  if (state.status === 'loading') return <FullPageSpinner label="Opening board" />;
  if (state.status === 'card') return <EmbedCard card={state.card} onSignIn={signIn} onOpen={openInFreero} onRetry={() => void start()} />;
  if (!host || !view) return <FullPageSpinner label="Opening board" />;

  const mayEdit = !readonly && canWrite(view.board.role);
  const accessory = (
    <div className="fr-embedbar">
      {view.token === null ? (
        <Button size="sm" variant="ghost" icon={LogIn} onClick={signIn}>
          Sign in
        </Button>
      ) : mayEdit ? (
        editing ? (
          <Button size="sm" variant="ghost" icon={Eye} onClick={() => setEditing(false)}>
            Stop editing
          </Button>
        ) : (
          <Button size="sm" variant="primary" icon={Pencil} onClick={() => void startEditing()}>
            {view.board.role === 'commenter' ? 'Comment' : 'Edit'}
          </Button>
        )
      ) : null}
      <Button size="sm" variant="ghost" icon={ExternalLink} onClick={openInFreero}>
        Open in Freero
      </Button>
    </div>
  );
  // A new socket when editing starts or stops (the server caps a read-only socket itself).
  return <BoardEngine key={`${view.token ?? 'visitor'}:${editing}`} host={host} features={features} topbarAccessory={accessory} location={location} />;
}

/** The site framing this page, for the popup to name ("… on notion.so"); null when the browser doesn't say. */
function embedderHost(): string | null {
  try {
    const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    const origin = ancestors?.length ? ancestors[0] : document.referrer ? new URL(document.referrer).origin : null;
    return origin ? new URL(origin).host : null;
  } catch {
    return null;
  }
}

const CARDS: Record<Card, { title: string; text: string }> = {
  off: { title: 'This board can’t be shown here', text: 'Its owner hasn’t turned on embedding, or its workspace doesn’t allow it.' },
  signin: { title: 'Sign in to see this board', text: 'It’s shared with specific people. Sign in with your Freero account to see it here.' },
  'no-access': { title: 'You don’t have access to this board', text: 'Open it in Freero to ask its owner for access, or sign in with another account.' },
  full: { title: 'Lots of people are watching', text: 'Too many visitors are viewing this board here right now. Open it in Freero, or try again in a moment.' },
  'popup-blocked': { title: 'Allow the sign-in window', text: 'Your browser blocked the window Freero opens to sign you in. Allow pop-ups for this page and try again.' },
  error: { title: 'Couldn’t open this board', text: 'Freero couldn’t be reached. Check your connection and try again.' },
};

function EmbedCard({ card, onSignIn, onOpen, onRetry }: { card: Card; onSignIn: () => void; onOpen: () => void; onRetry: () => void }) {
  const c = CARDS[card];
  return (
    <div className="fr-boarderror fr-embedcard">
      <div className="fr-boarderror__card">
        <Logo size={32} />
        <h1>{c.title}</h1>
        <p>{c.text}</p>
        <div className="fr-boarderror__actions">
          {card === 'signin' || card === 'no-access' || card === 'popup-blocked' ? (
            <Button variant="primary" icon={LogIn} onClick={onSignIn}>
              {card === 'no-access' ? 'Use another account' : 'Sign in'}
            </Button>
          ) : null}
          {card === 'full' || card === 'error' ? (
            <Button variant="primary" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          <Button icon={ExternalLink} onClick={onOpen}>
            Open in Freero
          </Button>
        </div>
      </div>
    </div>
  );
}
