import { defineFeature } from '@engine';

// Agent control rooms (KAI-172, KAI-249): an agent's lane is a "Tasks · <agent>" kanban the server's
// post_status writes (@freero/shared controlRoom.ts). This feature lets people pause that agent from
// the board. `agentPauses` (lane kanban id -> AgentPauseRecord) is READ BY THE SERVER: while a lane
// is paused, the agent's API / MCP writes on the board are refused with agent_paused.
export default defineFeature({
  name: 'controlroom',
  description: 'Agent control rooms: pause and resume an AI agent from its lane on the board; a paused lane says so, and the agent can’t change the board until someone resumes it.',
  owns: ['agentPauses'],
});
