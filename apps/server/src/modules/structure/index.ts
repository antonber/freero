// Public API of modules/structure [S2]: laying a structure out and placing it on a board, used by
// its own route, the public API (modules/api, which the MCP server goes through) and in-app AI
// (modules/ai).
import { SINKS } from './sinks';

export { insertStructure, newElementId, readPlacement } from './service';
// Placement by meaning (into a frame / kanban column / cluster, or a new frame / kanban): the
// tracker import places its cards with the same rules.
export { placeLaid, clusterOf, LOOSE_TYPES, type Placed } from './place';
export { planMoveInto } from './plan';
/**
 * Where a structure may go (`target`). The suggestions layer (KAI-169) adds 'suggestions' as a
 * sink; MCP offers propose_changes once it exists.
 */
export const structureTargets = (): string[] => Object.keys(SINKS);
