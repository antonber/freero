// Public API of modules/docs [S2] (KAI-162): the doc app's operations. No table of its own — a doc
// is a boards container of kind 'doc' whose document realtime stores — so the public API and MCP
// call these instead of re-deriving a doc's rules.
export { createDoc, readDoc, exportDocMarkdown, appendMarkdown, titleFromMarkdown, type CreateDocInput } from './service';
