// Public API of modules/outline [S2]: the semantic read model of a board for one reader, used by
// its own route, the public API (modules/api), in-app AI (modules/ai) and later MCP.
export { boardOutline, boardComments, MAX_BUDGET, MAX_LIMIT, MIN_BUDGET, type OutlineQuery, type OutlineReader, type OutlineResult } from './service';
export { parseOutlineQuery } from './routes';
