// Local (never synced) UI state shared by the voting panels and commands, plus the hook that
// derives everything the UI shows from the `voting` collection and the board's elements.
import { useMemo } from 'react';
import { create } from 'zustand';
import type { BoardElement, VotingSession } from '@freero/shared';
import { useCollection, useEditor, useElements, useRole, richTextToPlain, type Editor } from '@engine';
import {
  SESSION_KEY,
  ballotKey,
  ballotsOf,
  countedVotes,
  isEligible,
  ranked,
  tally,
  voters,
  type Ballot,
  type Voter,
  type VotingValue,
} from './voting';

export const RESULTS_PANEL_ID = 'voting.results';
/** The "Start voting" dialog panel: editor.openPanel(START_DIALOG_ID). */
export const START_DIALOG_ID = 'voting.start';

interface VotingUi {
  /** Session id whose results this user closed (hides bar + badges locally). */
  hiddenSessionId: string | null;
  hide(sessionId: string | null): void;
}

export const useVotingUi = create<VotingUi>((set) => ({
  hiddenSessionId: null,
  hide: (hiddenSessionId) => set({ hiddenSessionId }),
}));

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
  canVote: boolean;
  canManage: boolean;
  exists(id: string): boolean;
}

export function readSession(entries: Array<[string, VotingValue]>): VotingSession | undefined {
  const v = entries.find(([k]) => k === SESSION_KEY)?.[1];
  return v && 'votesPerUser' in v ? v : undefined;
}

export function useVoting(): VotingView {
  const editor = useEditor();
  const entries = useCollection<VotingValue>('voting');
  const elements = useElements();
  const role = useRole();
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
    const own = session ? countedVotes(entries.find(([k]) => k === ballotKey(session.id, userId))?.[1] as Ballot | undefined, session, exists) : [];
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
      canVote: !!session?.active && canEdit,
      canManage: !!session && canEdit && (session.startedBy === userId || role === 'owner'),
      exists,
    };
  }, [entries, elements, role, hiddenSessionId, userId]);
}

/** One-line text preview of an element for the results list. */
export function previewOf(editor: Editor, el: BoardElement): string {
  const fromDef = editor.getDefinition(el.type)?.toPlainText?.(el as never, editor);
  let text = fromDef ?? '';
  if (!text && 'title' in el && typeof el.title === 'string') text = el.title;
  if (!text && 'text' in el && typeof el.text === 'string') text = richTextToPlain(el.text);
  text = text.replace(/\s+/g, ' ').trim();
  if (text) return text;
  return el.type === 'sticky' ? 'Empty sticky' : el.type === 'shape' ? 'Shape' : el.type === 'card' ? 'Untitled card' : `${el.type[0].toUpperCase()}${el.type.slice(1)}`;
}
