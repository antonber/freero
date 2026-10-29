// ---- Agent control rooms (KAI-172, KAI-249) ----
// A long-running agent keeps a LANE on a board: a "Plan · <agent>" note, a "Status · <agent>" note
// and a "Tasks · <agent>" kanban (To do / Doing / Done / Blocked). The lane is plain board content
// found by those headings — the server's post_status / get_feedback (apps/server/src/modules/api/
// controlRoom.ts) and the web's controlroom feature read them with the rules below.
//
// Pausing an agent (KAI-249): a person who can edit the board pauses a lane from the board; until
// someone resumes it, the agent's writes on that board are refused with AGENT_PAUSED.
//
//   collection  AGENT_PAUSES_COLLECTION ('agentPauses'), owner: features/controlroom
//   key         the lane's kanban id
//   value       AgentPauseRecord (who paused it, when); deleted on resume
//
// The server only READS it. Session state, not board content: restoring a version leaves it as it
// is (Y_KEPT_ON_RESTORE).

export const AGENT_PAUSES_COLLECTION = 'agentPauses';

export interface AgentPauseRecord {
  /** Who paused it (a user id). */
  by: string;
  byName: string;
  at: number;
}

/** The API / MCP error code of a write refused because a person paused the agent's lane. */
export const AGENT_PAUSED = 'agent_paused';

export type LanePart = 'Tasks' | 'Plan' | 'Status';
const SEP = ' · ';

/** "Tasks · Builder". */
export const laneTitle = (part: LanePart, agent: string): string => `${part}${SEP}${agent}`;

/** Lane names compare like people read them: case, spacing and surrounding blanks don't matter. */
export const laneKey = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The agent a lane heading names ("Tasks · Builder" → "Builder"; any spacing or case), or null. */
export function laneAgentOf(heading: string, part: LanePart = 'Tasks'): string | null {
  const line = heading.trim().split('\n')[0]?.trim() ?? '';
  const m = /^(\S+)\s*·\s*(.+)$/.exec(line);
  if (!m || m[1].toLowerCase() !== part.toLowerCase()) return null;
  const agent = m[2].trim();
  return agent || null;
}
