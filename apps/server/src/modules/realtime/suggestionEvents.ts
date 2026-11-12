// Proposals made on this instance (KAI-169), for the activity feed: "Claude for Maria suggested 6
// changes". Each proposal is reported once (the instance that wrote it). Accepting them needs no
// activity event of its own: the accepted change is an ordinary edit (a socket's, or a request's),
// which changes.ts already reports, attributed to whoever accepted it. Never board text.
//
// Decisions (#82) are reported too, for a module that proposed something and acts once it is
// accepted (the trackers module links accepted proposed imports to their issues).
import type { ActingApp, SuggestionAuthor, SuggestionAuthorKind, SuggestionDecision, SuggestionRecord } from '@freero/shared';
import { logError } from '../../platform/log';
import type { ChangeDoor } from './changes';

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

/**
 * Decisions applied on this instance: an editor's socket accepting, rejecting or undoing either
 * (after `guardSuggestionWrites` let it through), a request (the public API), or Freero withdrawing
 * a revoked app's. Reported once, by the instance that applied them, with what each record
 * proposed. Records are written only by the server and a socket can only set a decision naming
 * itself, so a listener can trust that `accepted` means an editor accepted that server-made record.
 */
export interface SuggestionsDecidedEvent {
  boardId: string;
  /** Who decided (the socket's or request's user; for a withdrawal, the person it acted for). */
  actorId: string;
  /** How the decision reached the board (product analytics); absent for a withdrawal. */
  door?: ChangeDoor;
  decisions: Array<{
    suggestionId: string;
    groupId: string;
    op: SuggestionRecord['op'];
    /** create: the new item's id; update / delete: the item it changes. */
    itemId: string | null;
    /** reopened: an accept or a reject undone (pending again). */
    status: 'accepted' | 'rejected' | 'reopened';
    /** Who proposed it: a person, an app or token acting for one, or Freero's AI. */
    author: SuggestionAuthorKind;
    /** Rejected by Freero, not a person: the app or token that proposed it was revoked (KAI-224). */
    withdrawn: boolean;
  }>;
}

type DecidedListener = (e: SuggestionsDecidedEvent) => void;
const decidedListeners = new Set<DecidedListener>();

export function onSuggestionsDecided(fn: DecidedListener): () => void {
  decidedListeners.add(fn);
  return () => decidedListeners.delete(fn);
}

/** Reports decision steps (each record and its decision now; undefined: pending again). */
export function emitSuggestionsDecided(
  boardId: string,
  actorId: string,
  steps: ReadonlyArray<{ record: SuggestionRecord; to: SuggestionDecision | undefined }>,
  door?: ChangeDoor,
): void {
  if (!steps.length || !decidedListeners.size) return;
  const e: SuggestionsDecidedEvent = {
    boardId,
    actorId,
    ...(door ? { door } : {}),
    decisions: steps.map(({ record: r, to }) => ({
      suggestionId: r.id,
      groupId: r.groupId,
      op: r.op,
      itemId: (r.op === 'create' ? r.element?.id : r.targetId) ?? null,
      status: to ? to.status : 'reopened',
      author: r.author.kind,
      withdrawn: to?.withdrawn === true,
    })),
  };
  for (const fn of decidedListeners) {
    try {
      fn(e);
    } catch (err) {
      logError('realtime: a suggestion decisions listener failed', err);
    }
  }
}
