// Public API of modules/objects [S2]: the object registry and the one permission check (KAI-147).
// Every surface that shows or acts on Freero objects by address — the REST and public APIs, the
// MCP server, embeds and smart links, backlinks, search — asks `can` / `filterObjects` /
// `resolveObjects` here instead of re-implementing a type's access rules. Owning modules register
// their types with `registerObjectType` from their init.ts.
export {
  registerObjectType,
  accessOf,
  can,
  covers,
  filterObjects,
  summarizeObjects,
  resolveObjects,
  type Actor,
  type AccessPurpose,
  type ObjectLookup,
  type ObjectTypeHandler,
} from './registry';
export { appOrigins } from './origins';
