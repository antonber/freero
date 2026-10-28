// Public API of modules/structure [S2]: laying a structure out and placing it on a board, used by
// its own route, the public API (modules/api, which the MCP server goes through) and in-app AI
// (modules/ai).
import { SINKS } from './sinks';

export { insertStructure, newElementId } from './service';
/**
 * Where a structure may go (`target`). The suggestions layer (KAI-169) adds 'suggestions' as a
 * sink; MCP offers propose_changes once it exists.
 */
export const structureTargets = (): string[] => Object.keys(SINKS);
