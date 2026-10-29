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

/** The ticket, read once and removed from the address (a reload can't reuse it, nor a screenshot leak it). */
let taken: string | null | undefined;
function takeTicket(): string | null {
  if (taken === undefined) {
    taken = new URLSearchParams(window.location.hash.slice(1)).get('ticket');
    if (taken) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
  return taken;
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
