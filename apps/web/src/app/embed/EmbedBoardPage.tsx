// Route /embed/board/:id#ticket=… — the board inside an AI assistant's live view (MCP Apps, KAI-171).
// The assistant's view (modules/mcp views/live.html) frames this page with the single-use ticket a
// tool call minted; the page redeems it for a short-lived token, drops it from the URL and mounts
// the real board engine on a socket that signs in with that token — never the session cookie,
// which a third-party frame doesn't get (and mustn't use) anyway. When the view ends (expired,
// access gone) it tells the frame around it, which offers to reconnect.
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import type { EmbedRedeemResponse } from '@freero/shared';
import { BoardEngine, type Host } from '@engine';
import { Logo, useToast } from '@ui';
import { api } from '../api/client';
import { features } from '../board/features';
import { createEmbedHost, toastNotify } from '../board/host';
import { FullPageSpinner } from '../components/FullPageSpinner';
import '../board/BoardPage.css';

type Theme = 'light' | 'dark';
const asTheme = (v: unknown): Theme | null => (v === 'light' || v === 'dark' ? v : null);

/** The ticket, read once and removed from the address (a reload can't reuse it, nor a screenshot leak it). */
let taken: string | null | undefined;
/** The assistant's theme when the view opened (`#…&theme=dark`, live.html), read with the ticket. */
let openedIn: Theme | null = null;
function takeTicket(): string | null {
  if (taken === undefined) {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    taken = hash.get('ticket');
    openedIn = asTheme(hash.get('theme'));
    if (taken) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
  return taken;
}

/**
 * The board follows the assistant's light / dark theme (#89): live.html passes it when it opens this
 * page and posts `{ freeroEmbed: 'theme', theme }` whenever the assistant switches. Only the frame
 * around this page is listened to, and a theme is all it can set.
 */
function useAssistantTheme(): void {
  useEffect(() => {
    const root = document.documentElement;
    const apply = (t: Theme | null) => {
      if (t) root.setAttribute('data-theme', t);
    };
    takeTicket(); // reads the theme it opened in with the ticket
    apply(openedIn);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || window.parent === window) return;
      const d = e.data as { freeroEmbed?: unknown; theme?: unknown } | null;
      if (d && d.freeroEmbed === 'theme') apply(asTheme(d.theme));
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      root.removeAttribute('data-theme');
    };
  }, []);
}
/** One redemption per ticket (React's development double mount must not spend it twice). */
const redeemed = new Map<string, Promise<EmbedRedeemResponse>>();

/** Tells the assistant's view around this frame that the live view ended. */
function ended(reason: 'expired' | 'access'): void {
  if (window.parent !== window) window.parent.postMessage({ freeroEmbed: 'ended', reason }, '*');
}

type State = { status: 'loading' } | { status: 'ready'; view: EmbedRedeemResponse } | { status: 'error'; message: string };

export default function EmbedBoardPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const notify = useToast();
  const [state, setState] = useState<State>({ status: 'loading' });
  useAssistantTheme();

  useEffect(() => {
    const ticket = takeTicket();
    if (!ticket) {
      setState({ status: 'error', message: 'This live view has expired. Ask the assistant to show the board again.' });
      ended('expired');
      return;
    }
    let p = redeemed.get(ticket);
    if (!p) redeemed.set(ticket, (p = api.redeemEmbed(ticket)));
    let cancelled = false;
    p.then(
      (view) => {
        if (cancelled) return;
        if (view.board.id !== id) setState({ status: 'error', message: 'This live view is for another board.' });
        else setState({ status: 'ready', view });
      },
      (err) => {
        if (cancelled) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
        ended('expired');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The token's end is the view's end: the frame around offers to reconnect.
  const view = state.status === 'ready' ? state.view : null;
  useEffect(() => {
    if (!view) return;
    const t = setTimeout(() => ended('expired'), Math.max(0, view.expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [view]);

  const toast = useMemo(() => toastNotify(notify), [notify]);
  const host = useMemo<Host | null>(() => (view ? createEmbedHost(view, { notify: toast }) : null), [view, toast]);

  if (state.status === 'error')
    return (
      <div className="fr-boarderror">
        <div className="fr-boarderror__card">
          <Logo size={36} />
          <h1>This live view has ended</h1>
          <p>{state.message}</p>
        </div>
      </div>
    );
  if (!host) return <FullPageSpinner label="Opening board" />;
  return <BoardEngine host={host} features={features} location={location} />;
}
