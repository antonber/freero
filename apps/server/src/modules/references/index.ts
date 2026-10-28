// Public API of modules/references [S2]: the references index (KAI-149) — which board content
// points at which Freero object — and "what links here" for a reader. Derived from saved board
// content by an outbox consumer (init.ts); the API, MCP and later search read it through here.
export { backlinksOf, rebuildReferences, deriveBoardReferences, referencesConsumer, REFERENCES_CONSUMER } from './service';
export { referencesFrom } from './repo';
