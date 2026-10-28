// Public API of modules/outline [S2]: the board outline (KAI-166) for one reader, as the REST
// route serves it — what other modules (AI, later the public API and MCP) read boards through.
export { boardOutline, type OutlineQuery, type OutlineResult } from './service';
