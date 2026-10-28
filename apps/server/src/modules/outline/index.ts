// Public API of modules/outline [S2]: the semantic read model of a board for one reader, used by
// its own route, the public API (modules/api) and later MCP and in-app AI.
export { boardOutline, boardComments, MAX_BUDGET, MAX_LIMIT, MIN_BUDGET, type OutlineQuery, type OutlineReader, type OutlineResult } from './service';
export { parseOutlineQuery } from './routes';
