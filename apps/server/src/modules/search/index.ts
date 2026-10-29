// Public API of modules/search [S2]: permission-aware search of what boards say (KAI-151, KAI-141).
// The index is derived from saved board content through the outbox (init.ts); the app's route,
// the public API and the MCP server all search through `searchFor`, which re-checks the reader's
// live access to every board before showing anything of it.
export { searchFor, rebuildSearch, deriveBoardSearch, searchConsumer, SEARCH_CONSUMER, type SearchQuery, type SearchOptions } from './service';
