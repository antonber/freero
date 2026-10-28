// Proposals made on this instance (KAI-169), for the activity feed: "Claude for Maria suggested 6
// changes". Each proposal is reported once (the instance that wrote it). Accepting them needs no
// event of its own: the accepted change is an ordinary edit (a socket's, or a request's), which
// changes.ts already reports, attributed to whoever accepted it. Never board text.
import type { ActingApp, SuggestionAuthor } from '@freero/shared';
import { logError } from '../../platform/log';

export interface SuggestionsProposedEvent {
  boardId: string;
  /** The person it was proposed for (or by). */
  actorId: string;
  /** The app or token that proposed it for them (the API, MCP), else null. */
  via: ActingApp | null;
  author: SuggestionAuthor;
  /** How many changes the proposal holds. */
  count: number;
}

type Listener = (e: SuggestionsProposedEvent) => void;
const listeners = new Set<Listener>();

export function onSuggestionsProposed(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitSuggestionsProposed(e: SuggestionsProposedEvent): void {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch (err) {
      logError('realtime: a suggestions listener failed', err);
    }
  }
}
