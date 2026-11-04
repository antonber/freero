// Local (never synced) UI state shared by the voting panels and commands, plus the hook that
// derives everything the UI shows from the `voting` collection and the board's elements.
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { BoardElement, VotingHistoryEntry, VotingSession } from '@freero/shared';
import { useCollection, useEditor, useElements, useParticipant, usePrivateCollection, useRole, richTextToPlain, type Editor } from '@engine';
import {
  SESSION_KEY,
  ballotKey,
  ballotsOf,
  countedVotes,
  historyOf,
  isEligible,
  ranked,
  tally,
  voters,
  type Ballot,
  type Voter,
  type VotingValue,
} from './voting';

import { t as tr } from '../messages';
export const RESULTS_PANEL_ID = 'voting.results';
/** The "Start voting" dialog panel: editor.openPanel(START_DIALOG_ID). */
export const START_DIALOG_ID = 'voting.start';

interface VotingUi {
  /** Session id whose results this user closed (hides bar + badges locally). */
  hiddenSessionId: string | null;
  hide(sessionId: string | null): void;
  /** A past vote this user reopened in the results panel (its id), or null for the current one. */
  pastId: string | null;
  openPast(sessionId: string | null): void;
}

export const useVotingUi = create<VotingUi>((set) => ({
  hiddenSessionId: null,
  hide: (hiddenSessionId) => set({ hiddenSessionId }),
  pastId: null,
  openPast: (pastId) => set({ pastId }),
}));

/** Server-clock now, re-read every `everyMs` while `on` (a vote's countdown); a fixed value otherwise. */
export function useServerNow(editor: Editor, on: boolean, everyMs = 500): number {
  const [now, setNow] = useState(() => editor.host.serverNow());
  useEffect(() => {
    if (!on) return;
    setNow(editor.host.serverNow());
    const t = setInterval(() => setNow(editor.host.serverNow()), everyMs);
    return () => clearInterval(t);
  }, [editor, on, everyMs]);
  return now;
}

export interface VotingView {
  session: VotingSession | undefined;
  /** Session exists and this user hasn't closed its results. */
  visible: boolean;
  eligible: BoardElement[];
  ineligible: BoardElement[];
  totals: Map<string, number>;
  ranking: Array<{ id: string; votes: number; rank: number }>;
  mine: Map<string, number>;
  votesLeft: number;
  voters: Voter[];
  totalVotes: number;
  /** Results may be shown (session ended, or results aren't hidden). */
  showTotals: boolean;
  /** This user may vote in it now: an editor, or a participant (Editor.isParticipant). */
  canVote: boolean;
  /** Not an editor, but voting as a participant (commenter or guest). */
  participant: boolean;
  canManage: boolean;
  /** Past votes kept for the results panel, newest first. */
  history: VotingHistoryEntry[];
  exists(id: string): boolean;
}

export function readSession(entries: Array<[string, VotingValue]>): VotingSession | undefined {
  const v = entries.find(([k]) => k === SESSION_KEY)?.[1];
  return v && 'votesPerUser' in v ? v : undefined;
}

export function useVoting(): VotingView {
  const editor = useEditor();
  const entries = useCollection<VotingValue>('voting');
  const sealedEntries = usePrivateCollection<VotingValue>('voting');
  const elements = useElements();
  const role = useRole();
  const participant = useParticipant();
  const hiddenSessionId = useVotingUi((s) => s.hiddenSessionId);
  const userId = editor.user.id;

  return useMemo(() => {
    const session = readSession(entries);
    const canEdit = role === 'editor' || role === 'owner';
    const byId = new Map(elements.map((e) => [e.id, e]));
    const exists = (id: string) => {
      const el = byId.get(id);
      return !!el && !!session && isEligible(session, el);
    };
    const eligible: BoardElement[] = [];
    const ineligible: BoardElement[] = [];
    if (session) for (const el of elements) (isEligible(session, el) ? eligible : ineligible).push(el);
    const ballots = session ? ballotsOf(entries, session) : [];
    const totals = session ? tally(session, ballots, exists) : new Map<string, number>();
    // While results are hidden, this user's own ballot is the sealed one (the shared key only says "voted").
    const ownFrom = session?.active && session.anonymous ? sealedEntries : entries;
    const own = session ? countedVotes(ownFrom.find(([k]) => k === ballotKey(session.id, userId))?.[1] as Ballot | undefined, session, exists) : [];
    const mine = new Map<string, number>();
    for (const id of own) mine.set(id, (mine.get(id) ?? 0) + 1);
    let totalVotes = 0;
    totals.forEach((n) => (totalVotes += n));
    return {
      session,
      visible: !!session && hiddenSessionId !== session.id,
      eligible,
      ineligible,
      totals,
      ranking: ranked(totals, elements.map((e) => e.id)),
      mine,
      votesLeft: session ? Math.max(0, session.votesPerUser - own.length) : 0,
      voters: session ? voters(ballots, session, exists) : [],
      totalVotes,
      showTotals: !!session && (!session.active || !session.anonymous),
      canVote: !!session?.active && (canEdit || participant),
      participant: participant && !canEdit,
      canManage: !!session && canEdit && (session.startedBy === userId || role === 'owner'),
      history: historyOf(entries),
      exists,
    };
  }, [entries, sealedEntries, elements, role, participant, hiddenSessionId, userId]);
}

/** One-line text preview of an element for the results list. */
export function previewOf(editor: Editor, el: BoardElement): string {
  const fromDef = editor.getDefinition(el.type)?.toPlainText?.(el as never, editor);
  let text = fromDef ?? '';
  if (!text && 'title' in el && typeof el.title === 'string') text = el.title;
  if (!text && 'text' in el && typeof el.text === 'string') text = richTextToPlain(el.text);
  text = text.replace(/\s+/g, ' ').trim();
  if (text) return text;
  return el.type === 'sticky' ? tr('emptySticky') : el.type === 'shape' ? 'Shape' : el.type === 'card' ? tr('untitledCard') : `${el.type[0].toUpperCase()}${el.type.slice(1)}`;
}
