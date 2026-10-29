// Pausing an agent from its control room (KAI-249; @freero/shared controlRoom.ts). A person who can
// edit the board pauses a lane there (web features/controlroom writes the `agentPauses` collection);
// the server only reads it. While a lane is paused:
//   - posting to that lane (post_status, also as the template's placeholder lane) is refused, and
//   - every other write of the agent's credential on that board is refused too — the credential's
//     own lanes are the ones named like it (the default lane name) or made by it (`createdVia`).
// Refused with 423 `agent_paused` (MCP: a tool error naming it), before anything is written or
// counted against the agent's write budget. Reads (get_feedback, the outline) still work, so the
// agent can see it was paused and wait.
import {
  AGENT_PAUSED,
  AGENT_PAUSES_COLLECTION,
  laneAgentOf,
  laneKey,
  richTextToPlain,
  type ActingApp,
  type AgentPauseRecord,
  type KanbanElement,
} from '@freero/shared';
import { HttpError } from '../../platform/http';
import type { BoardView } from '../realtime/index';

export interface PausedLane {
  /** The lane's kanban. */
  kanbanId: string;
  /** The lane's name (board text: never in Freero's own words, like errors). */
  agent: string;
  /** Who paused it, as the record says (written by a board socket: untrusted too). */
  byName: string;
  /** The app or token that made the lane (its first post), if one did. */
  madeBy: string | null;
}

/** Every paused lane on the board as `view` shows it. */
export function pausedLanes(view: BoardView): PausedLane[] {
  const pauses = view.collection(AGENT_PAUSES_COLLECTION);
  if (!pauses.size) return [];
  const out: PausedLane[] = [];
  for (const { el } of view.elements) {
    if (el.type !== 'kanban' || !pauses.has(el.id)) continue;
    const agent = laneAgentOf(richTextToPlain(String((el as KanbanElement).title ?? '')));
    if (!agent) continue;
    const rec = pauses.get(el.id) as Partial<AgentPauseRecord> | null;
    out.push({ kanbanId: el.id, agent, byName: typeof rec?.byName === 'string' && rec.byName ? rec.byName : 'Someone', madeBy: el.createdVia?.id ?? null });
  }
  return out;
}

/** The paused lane that stops `via` writing on this board (one of its own lanes), or null. */
export function pauseOf(view: BoardView, via: ActingApp): PausedLane | null {
  return pausedLanes(view).find((p) => p.madeBy === via.id || laneKey(p.agent) === laneKey(via.name)) ?? null;
}

/** In Freero's own words only: the lane's name and who paused it are board content. */
export function pausedError(): HttpError {
  return new HttpError(
    423,
    'A person paused this agent on this board: its writes here are refused until someone resumes it on the board. Stop and wait; get_feedback says paused: false once it is resumed',
    AGENT_PAUSED,
  );
}
